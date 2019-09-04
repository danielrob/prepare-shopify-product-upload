require('dotenv').config()
// imports
const dateFormat = require('dateformat');
const XLSX = require('xlsx')
const fs = require('fs-extra')
const path = require('path')
const once = require('once')
const express = require('express')
const serveStatic = require('serve-static')
const ngrok = require('ngrok')
const { uniq, uniqBy, sortBy, orderBy, keyBy, mapValues } = require('lodash')

// CONFIG
// You have the option to run `http-server .` and `ngrok http 8080` manually to provide a
// persistent ngrok url rather than the script creating one each time the script runs -
// create a .env file and fill in the prefix value to use this option.
const NGROK_PREFIX = process.env.NGROK_PREFIX;

// You have the option to generate a partial import including only selected SKUS
const SKUS_TO_INCLUDE = process.env.SKUS_TO_INCLUDE
if (SKUS_TO_INCLUDE) {
  console.info(`including only the following SKUS ${SKUS_TO_INCLUDE}`)
}

// You have the option to skip image upload, and only upload/update product details.
const SKIP_IMAGE_UPLOAD = process.env.SKIP_IMAGE_UPLOAD === 'true'

// Port to run the static file web server on
const SERVER_PORT = process.env.SERVER_PORT || 8080


// file / folder names
const ASSETS_FOLDERNAME = 'assets'
const IMAGES_FOLDERNAME = 'images'
const PRODUCTS_FILENAME = 'products.xlsx'
const OUTPUT_FOLDERNAME = 'output'
const OUTPUT_FILENAME = `${SKUS_TO_INCLUDE ? 'partial-' : ''}import-${dateFormat(new Date(), SKUS_TO_INCLUDE ? 'yyyy-mm-dd HH:MM:ss' : 'isoDate')}.csv`

// setup
let NGROK_URL = process.env.NGROK_URL || (NGROK_PREFIX && `https://${NGROK_PREFIX}.ngrok.io`)
const IS_CREATE_NGROK_MODE = !NGROK_URL
let SELECTED_IMPORT_SCHEMA = require('./shopify-csv-schema')
const ROOT = path.join(__dirname, '..')
const ASSETS_DIR = path.join(ROOT, ASSETS_FOLDERNAME)
const PRODUCTS_FILE = path.join(ASSETS_DIR, PRODUCTS_FILENAME)
const IMAGES_DIR = path.join(ASSETS_DIR, IMAGES_FOLDERNAME)
const BUILD_DIR = path.join(ROOT, OUTPUT_FOLDERNAME)
const OUTPUT_CSV = path.join(BUILD_DIR, OUTPUT_FILENAME)
const CSV_SEPERATOR = csvs = ','

function runScript() {
  if (!NGROK_URL) {
    const app = express()
    app.use(serveStatic(IMAGES_DIR))
    app.listen(SERVER_PORT)
    console.info(`Started static server on port ${SERVER_PORT}`)

    ;(async function() {
      NGROK_URL = await ngrok.connect({ addr: SERVER_PORT });
      console.info(`Connected ngrok proxy at ${NGROK_URL}`)
      generateCSV()
    })();
  } else {
    generateCSV()
  }
}

/**
  @function generateCSV:
    Convert a custom single-row-per-product products schema file
    plus images on the file system to a shopify importable product csv.
    The csvs' image urls are public urls that point to your local file
    system via ngrok and a static file web server.

    You can write any transforms you wish to simplify the client facing
    products.xlsx depending on the business cases. E.g. derive the collection from the SKU etc.
  @returns void
*/
function generateCSV() {
  const workbook = XLSX.readFile(PRODUCTS_FILE);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const sheet = XLSX.utils.sheet_to_json(worksheet)
  const skusToHandles = makeSkusToHandlesDictionary(sheet)
  const selectedSkus = SKUS_TO_INCLUDE ? SKUS_TO_INCLUDE.split(',') : false

  const products = sheet.reduce((accumulator, {
      /* The merchant facing excel column names: */
      "SKU": sku,
      "Shopify Handle & URL format": handle,
      "Title": title,
      "Materials": materials,
      "Dimensions": dimensions,
      "Description": description,
      "Similar Styles": similarStyles,
      "SEO Description": seoDescr = description,
      "SEO Description": seoTitle = title,
      "Price": price,
      "Tags": tagsFromTagsColumn,
      "Collection": collection,
      ...otherColumns // some column names might be dynamic
    }) => {
      const [mainImage = {}, ...additionalImages] = getImages(sku)
      if (selectedSkus && selectedSkus.indexOf(sku) === -1) {
        return accumulator
      }

      // Add product row to CSV
      accumulator.push(makeCsvRowString({
        /* The selected shopify import csv schema column names: */
        "Handle": handle,
        "Title": title,
        "Collection": getCollection(sku),
        "Body (HTML)": getBodyHtml({ materials, dimensions, description, similarStyles, skusToHandles }),
        "SEO Title": seoTitle,
        "SEO Description": seoDescr,
        "Variant Price": price,
        "Image Src": mainImage.src,
        "Image Position": mainImage.src && 1,
        "Image Alt Text": mainImage.alt,
        "Variant SKU": sku,
        "Tags": getTags({ tagsFromTagsColumn, otherColumns, price }),
      }))

      // Add additional product image rows to csv
      if (!SKIP_IMAGE_UPLOAD) {
        additionalImages.forEach((img, idx) =>
          accumulator.push(makeCsvRowString({
            // image rows only need these four items
            "Handle": handle,
            "Image Src": img.src || '',
            "Image Position": img.src ? idx + 2 : '',
            "Image Alt Text": img.alt || '',
          }))
        )
      }

      validateColumnsOnce(otherColumns)

      return accumulator
    },
    []
  )

  fs.writeFileSync(OUTPUT_CSV, makeCsv(products))
  console.info(
    `\nGenerated ${OUTPUT_CSV}`,
    `\n\nYou may now proceed to https://${process.env.SHOP || '<your-store>'}.myshopify.com/admin/products to select '${OUTPUT_FILENAME}' for import`,
    IS_CREATE_NGROK_MODE ? '\n\n Note: Keep this process alive until the import has succeeded in Shopify' : ''
  )
}

/**********
  Helpers
***********/
/**
  @function getImages:
    Scans the assets/images/sku folder for image files and returns data about them.
  @param sku - used to locate the corresponding products images
  @return array of objects [{ src: <ngrok image upload url>, alt: <image alt> }]
*/
function getImages(sku) {
  const imagesDir = path.join(IMAGES_DIR, sku)

  if (!fs.existsSync(imagesDir)) {
    console.warn(`No images found for ${sku}`)
    return []
  }

  return fs.readdirSync(imagesDir)
    .filter(fileName => (/\.(jpg|jpeg|png)$/i).test(fileName))
    .map(fileName => {
      // Current approach to alt text is to have a corresponding
      // text file next to each image file with the alt text.
      const altFile = path.join(imagesDir, fileName.replace(/\.(jpg|jpeg|png)$/, '.txt'))
      const alt = fs.existsSync(altFile) ? fs.readFileSync(altFile, 'utf8') : ''

      return ({
        src: `${NGROK_URL}/${sku}/${fileName}`,
        alt,
      })
    })
}

/**
  @function setSelectedImportSchema:
    Picks the columns that will actually be used in the ouput csv.
    Their order with respect to the shopify schema is preserved.
  @param sampleRowData
  @return void
*/
const setSelectedImportSchema = once(sampleRowData => {
  const selection = Object.keys(sampleRowData)

  SELECTED_IMPORT_SCHEMA = SELECTED_IMPORT_SCHEMA.reduce((keys, key) => {
    if (selection.indexOf(key) !== -1) {
      keys.push(key)
    }
    return keys
  }, [])
})

/**
  @function makeCsvRowString
  @param rowData - dictionary with keys matching the shopify csv import schema
  @return string - escaped and delimited with shopifys csv string delimiter (")
*/
function makeCsvRowString(rowData) {
  if (SKIP_IMAGE_UPLOAD) {
    delete rowData["Image Src"]
    delete rowData["Image Position"]
    delete rowData["Image Alt Text"]
  }

  setSelectedImportSchema(rowData) // memoized

  return SELECTED_IMPORT_SCHEMA
    .map(k => (
      rowData[k] === undefined // preserve falsy values
        ? ''
        : rowData[k]
      )
    )
    .map(v =>
      `"${`${v}`.replace(/"/g, '"""')}"`
    )
}

/**
  @function makeCsv
  @param rows - array of csv row strings
  @return string - csv file contents with shopify import csv headings.
*/
function makeCsv(rows) {
  return [SELECTED_IMPORT_SCHEMA.join(CSV_SEPERATOR), ...rows].join('\n')
}

/**
  @function validateColumnsOnce
  @param otherColumns - column names to validate.
  @return void
*/
const validateColumnsOnce = once(otherColumns => {
  Object.keys(otherColumns).forEach(columnName => {
    if (!columnName.startsWith('tag:')) {
      console.warn(`!!!! Warning !!!! Found extraneous column name: ${columnName}`)
    }
  })
})

/**
  @function makeSkusToHandlesDictionary
  @param sheet - the products sheet in json format
  @return void
*/
const makeSkusToHandlesDictionary = sheet => sheet.reduce(
  (
    out,
    {
      "SKU": sku,
      "Shopify Handle & URL format": handle
    }
  ) => {
    out[sku] = handle
    return out
  }, {}
)


/*********************
  CLIENT SPECIFIC TRANSFORMS (EXAMPLES)
**********************/
/**
  @function getCollection - example of client specific logic - generates the collection from SKU.
  @param sku - SKU of the product
  @returns string - Shopify collection name/id that this product should be assigned to.
*/
function getCollection(sku) {
  // first letter of SKU determines collection
  switch (sku[0].toUpperCase()) {
    case 'E':
      return "Earrings"
    case 'B':
      return "Bracelets"
    case 'N':
      return "Necklaces"
    case 'R':
      return "Rings"
    default:
      throw new Error('sku with unknown category')
  }
}

/**
  @function getBodyHtml
  @return string
*/
function getBodyHtml({ materials, dimensions, description, similarStyles, skusToHandles }) {
  return [
    `<p><span>MATERIALS <br></span><span>${materials}</span></p>`,
    `<p><span>DIMENSIONS <br></span><span>${dimensions}</span></p>`,
    `<p><span>DESCRIPTION <br></span><span>${description}</span> </p>`,
    getDescriptionMetadata({ similarStyles, skusToHandles }),
  ].join('')
}

/**
  @function getDescriptionMetadata - returns an HTML comment for embedding data (as an array) in the description field.
    This is an alternative to using metafields.
    The example following liquid can be used to extract this data:
    ----
    {% assign description = product.description | split: '<!-- meta:' | first %}
    {% assign meta = product.description | split: '<!-- meta:' | last | remove: ' -->' | split: '!!!' %}
    {% assign first_meta_item = meta[0] %}
    ----
  @return string
*/
function getDescriptionMetadata({ similarStyles = '', skusToHandles }) {
  const firstMetaItem = similarStyles.split(',\r\n').map(sku => skusToHandles[sku]).join(',');
  const divider = '!!!'
  return `<!-- meta:${firstMetaItem}${divider} -->`
}

/**
  @function getTags - determines output tags for this product.
  @return string - comma separated list of sanitized tag values
*/
function getTags({ tagsFromTagsColumn = '', otherColumns = {}, price }) {

  const tagsFromTagsColumnArray = tagsFromTagsColumn.split(',')

  const tagsFromTagColumnsArray = Object.entries(otherColumns)
    .reduce((accumulator, [columnName, applicable]) => {
      if (columnName.startsWith('tag:') && applicable) {
        accumulator.push(columnName.replace("tag:", ""))
      }
      return accumulator
    }, [])


  const priceTag =
    (50 <= price && price <= 200 && 'f50t200') ||
    (200 <= price && price <= 400 && 'f200t400') ||
    (400 <= price && price <= 1000 && 'f400t1000')

  const returnVal = [
    ...tagsFromTagsColumnArray,
    ...tagsFromTagColumnsArray,
    priceTag
  ]
  .filter(i => i)
  .map(t => t.toLowerCase().replace(/\s/g, ""))
  .join(',')

  return returnVal
}

// Run
runScript();