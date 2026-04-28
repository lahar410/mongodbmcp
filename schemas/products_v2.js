export const productsV2Schema = {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "sku",
        "name",
        "sku_type",
        "parent_sku",
        "item_qty",
        "mrp",
        "web_price",
        "net_weight",
        "gross_weight",
        "ean",
        "hero_image",
        "images",
        "ref_shopify_id",
        "shopify_id",
        "variant",
        "dimensions",
        "channels",
        "bulk",
        "account_sku",
        "inner_packing_sku",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
      ],
      properties: {
        _id: { bsonType: "objectId" },

        sku: { bsonType: "string" },
        name: { bsonType: "string" },
        sku_type: { bsonType: "string" },
        parent_sku: { bsonType: "string" },
        item_qty: { bsonType: "string" },

        mrp: { bsonType: "number" },
        web_price: { bsonType: "number" },
        net_weight: { bsonType: "number" },
        gross_weight: { bsonType: "number" },

        ean: { bsonType: "string" },
        hsn_code: { bsonType: "string" }, // optional (~6% of docs)

        rating: { bsonType: ["number", "null"] },

        hero_image: { bsonType: "string" },
        images: {
          bsonType: "array",
          items: { bsonType: "string" },
        },

        ref_shopify_id: { bsonType: "string" },
        shopify_id: { bsonType: "string" },

        variant: {
          bsonType: "object",
          required: ["value", "uom"],
          properties: {
            value: { bsonType: "string" },
            uom: { bsonType: "string" },
          },
        },

        dimensions: {
          bsonType: "object",
          required: ["length", "width", "height"],
          properties: {
            length: { bsonType: "number" },
            width: { bsonType: "number" },
            height: { bsonType: "number" },
          },
        },

        channels: {
          bsonType: "object",
          required: ["website", "distributor", "retailer"],
          properties: {
            website: { bsonType: "bool" },
            distributor: { bsonType: "bool" },
            retailer: { bsonType: "bool" },
          },
        },

        bulk: {
          bsonType: "object",
          required: ["_id", "sku"],
          properties: {
            _id: { bsonType: "objectId" },
            sku: { bsonType: "string" },
          },
        },

        account_sku: {
          bsonType: "object",
          required: ["retailer", "website", "ecommerce", "export", "others", "export_ecommerce"],
          properties: {
            retailer: { bsonType: "string" },
            website: { bsonType: "string" },
            ecommerce: { bsonType: "string" },
            export: { bsonType: "string" },
            others: { bsonType: "string" },
            export_ecommerce: { bsonType: "string" },
          },
        },

        inner_packing_sku: { bsonType: "array" },

        created_at: { bsonType: "date" },
        updated_at: { bsonType: "date" },
        created_by: { bsonType: "string" },
        updated_by: { bsonType: "string" },
      },
    },
  },
  validationLevel: "moderate",
  validationAction: "warn",
};

/**
 * Apply this schema validator to the existing collection:
 *
 *   import { productsV2Schema } from "./schemas/products_v2.js";
 *   await db.command({ collMod: "products_v2", ...productsV2Schema });
 *
 * Or create a new collection with validation:
 *
 *   await db.createCollection("products_v2", productsV2Schema);
 */
