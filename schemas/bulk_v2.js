export const bulkV2Schema = {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "sku",
        "trade_name",
        "technical_name",
        "sku_type",
        "bulk_type",
        "category",
        "sub_category",
        "uom",
        "hsn_code",
        "gst_rate",
        "bulk_min_order_qty",
        "dist_min_order_qty",
        "web_max_order_qty",
        "channels",
        "description",
        "technicals",
        "crops",
        "diseases",
        "dosage",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
      ],
      properties: {
        _id: { bsonType: "objectId" },

        sku: { bsonType: "string" },
        trade_name: { bsonType: "string" },
        technical_name: { bsonType: "string" },
        sku_type: { bsonType: "string" },
        bulk_type: { bsonType: "string" },
        category: { bsonType: "string" },
        sub_category: { bsonType: "string" },
        uom: { bsonType: "string" },
        hsn_code: { bsonType: "string" },
        gst_rate: { bsonType: "string" },

        bulk_min_order_qty: { bsonType: "string" },
        dist_min_order_qty: { bsonType: "string" },
        web_max_order_qty: { bsonType: "string" },

        channels: {
          bsonType: "object",
          required: ["website", "distributor", "retailer"],
          properties: {
            website: { bsonType: "bool" },
            distributor: { bsonType: "bool" },
            retailer: { bsonType: "bool" },
          },
        },

        description: {
          bsonType: "object",
          properties: {
            english: { bsonType: ["string", "null"] },
            hindi: { bsonType: ["string", "null"] },
          },
        },

        technicals: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["technical_sku", "technical_name", "value", "unit"],
            properties: {
              technical_sku: { bsonType: "string" },
              technical_name: { bsonType: "string" },
              value: { bsonType: "string" },
              unit: { bsonType: "string" },
            },
          },
        },

        crops: { bsonType: "array" },
        diseases: { bsonType: "array" },
        dosage: { bsonType: "array" },

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
 *   import { bulkV2Schema } from "./schemas/bulk_v2.js";
 *   await db.command({ collMod: "bulk_v2", ...bulkV2Schema });
 *
 * Or create a new collection with validation:
 *
 *   await db.createCollection("bulk_v2", bulkV2Schema);
 */
