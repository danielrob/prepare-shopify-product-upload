# Shopify Product Upload
*Prepare [import csv's](https://help.shopify.com/en/manual/products/import-export/import-products) to upload shopify products with associated photos directly from your file system using [ngrok](https://ngrok.com/).*

## Explanation
Shopify [does everything it can](https://help.shopify.com/en/manual/products/import-export/using-csv#copy-img-url) to confuse the fact that the file manager has practically *nothing* to do with product photos.

In truth the image urls in the import csv's just need to exist on a server somewhere, and are used once each during the import for Shopify to grab a copy of copy them. That server might as well be your own filesystem, which is easily done using ngrok and e.g. http-server.

Additionally, it is often useful to map a merchant-specific product specification spreadsheet to shopify's one, even if it's just renaming columns. This project allows that - see customisation below.

## Usage
1. Clone or [download](https://github.com/danielrob/shopify-product-upload/archive/master.zip) this project
1. You must have [node](https://nodejs.org) installed.
1. Using the command line, change directory into your cloned or downloaded folder e.g. `$ cd shopify-product-upload`
1. Run `$ npm install`
1. Open, edit, and save the `assets/products.xlsx` file - add your products.
1. Add your product images, grouped by SKU into the `assets/images` folder. To specify alt text for each, add a .txt file with the same name as the image in the same folders.
  1. Run `npm run start` and keep this process running.
  1. Navigate to `https://<your-store>.myshopify.com/admin/products` and click import. Select the generated csv file (e.g. `import.csv`) in the `output` folder for import, and click import. Wait.
  1. All your products will be uploaded. When done you can stop the process by typing `ctrl-c`.

## Customisation
In order to customise the behaviour you need to be able to code with javascript. Feel free to contact me at [dev@danielrob.dev](mailto:dev@danielrob.dev) if you want me to help you out.

In the `generateCSV` function in the `product-upload.js` file you'll see a bunch of column names (which you/the client/merchant will use) and that these are reduced to a bunch of shopify column names (that Shopify will use). Wherever it's appropriate, transform functions are/may be written to simplify the `products.xlsx` format.

## Modes
#### CSV generation debugging / development.
By default running `$ npm run start` starts an ngrok server for you. If you're mainly developing/debugging the csv generation you can create a `.env` file as per the `.env.sample` file and fill in the `NGROK_PREFIX` field. The field value can be garbage until you actually want to use the output file for upload i.e. during customisation.

#### Generate a csv for updating products without re-uploading images.
Add an `.env` file as per the `.env.sample` and set `SKIP_IMAGE_UPLOAD` to `true`.

#### Generate a csv to update only some products
Add an `.env` file as per the `.env.sample` and set `SKUS_TO_INCLUDE` to a comma seperated list of SKU codes for your products.

## FAQs
#### Metafields?
No support yet, but a hack method to embed data in the product description using html comments is included. Shopify help line said why not!