import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MongoClient } from "mongodb";
import express from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const __dir = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dir, "config.json");
const ENV_FILE = join(__dir, ".env");

// ─── Config (IP whitelist) ────────────────────────────────────────────────────

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    const defaults = {
      allowedIPs: [
        "127.0.0.1",
        "::1",
        "192.168.1.255",
        "192.168.1.2",
        "192.168.0.184",
      ],
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ─── MongoDB connection ───────────────────────────────────────────────────────

let mongoClient = null;
let mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

async function getClient() {
  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri, {
      dbName: "CRM-Database",
      maxPoolSize: 25,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      retryWrites: true,
    });
    await mongoClient.connect();
  }
  return mongoClient;
}

async function setMongoUri(newUri) {
  if (mongoClient) {
    try {
      await mongoClient.close();
    } catch {
      /* ignore */
    }
    mongoClient = null;
  }
  mongoUri = newUri;

  // Persist the new URI into .env
  let envContent = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  if (/^MONGO_DB_URI=/m.test(envContent)) {
    envContent = envContent.replace(
      /^MONGO_DB_URI=.*/m,
      `MONGO_DB_URI=${newUri}`,
    );
  } else {
    envContent += `\nMONGO_DB_URI=${newUri}\n`;
  }
  writeFileSync(ENV_FILE, envContent);

  // Verify the new URI works
  await getClient();
}

function maskedUri() {
  return mongoUri ? mongoUri.replace(/:[^:@]*@/, ":****@") : "not set";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJSON(s, label = "value") {
  try {
    return typeof s === "string" ? JSON.parse(s) : s;
  } catch {
    throw new Error(`Invalid JSON for ${label}: ${s}`);
  }
}

const ok = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

const fail = (e) => ({
  content: [{ type: "text", text: `Error: ${e.message}` }],
  isError: true,
});

// ─── MCP Server factory ───────────────────────────────────────────────────────
// A new McpServer instance is created per SSE session (SDK requirement).
// All instances share the same mongoClient / mongoUri globals.

function createServer() {
  const server = new McpServer({
    name: "mongodb-mcp",
    version: "1.0.0",
    description: "MongoDB MCP with IP auth and dynamic URI",
  });

  // ── Database / collection ────────────────────────────────────────────────

  server.tool("list_databases", "List all databases", {}, async () => {
    try {
      const c = await getClient();
      const r = await c.db().admin().listDatabases();
      return ok(r.databases);
    } catch (e) {
      return fail(e);
    }
  });

  server.tool(
    "list_collections",
    "List collections in a database",
    { database: z.string().describe("Database name") },
    async ({ database }) => {
      try {
        const c = await getClient();
        return ok(await c.db(database).listCollections().toArray());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "collection_stats",
    "Get statistics for a collection",
    { database: z.string(), collection: z.string() },
    async ({ database, collection }) => {
      try {
        const c = await getClient();
        return ok(await c.db(database).command({ collStats: collection }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── Read ──────────────────────────────────────────────────────────────────

  server.tool(
    "find",
    "Find documents in a collection",
    {
      database: z.string(),
      collection: z.string(),
      query: z
        .string()
        .optional()
        .describe('JSON filter, e.g. {"status":"active"}'),
      projection: z
        .string()
        .optional()
        .describe('JSON projection, e.g. {"name":1}'),
      sort: z.string().optional().describe('JSON sort, e.g. {"createdAt":-1}'),
      limit: z.number().optional().describe("Max docs (default 20)"),
      skip: z.number().optional(),
    },
    async ({ database, collection, query, projection, sort, limit, skip }) => {
      try {
        const c = await getClient();
        let cursor = c
          .db(database)
          .collection(collection)
          .find(query ? parseJSON(query, "query") : {}, {
            projection: projection
              ? parseJSON(projection, "projection")
              : undefined,
          });
        if (sort) cursor = cursor.sort(parseJSON(sort, "sort"));
        if (skip) cursor = cursor.skip(skip);
        cursor = cursor.limit(limit ?? 20);
        return ok(await cursor.toArray());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "find_one",
    "Find a single document",
    {
      database: z.string(),
      collection: z.string(),
      query: z.string().describe("JSON filter"),
      projection: z.string().optional(),
    },
    async ({ database, collection, query, projection }) => {
      try {
        const c = await getClient();
        const doc = await c
          .db(database)
          .collection(collection)
          .findOne(parseJSON(query, "query"), {
            projection: projection
              ? parseJSON(projection, "projection")
              : undefined,
          });
        return ok(doc);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "count_documents",
    "Count documents matching a filter",
    {
      database: z.string(),
      collection: z.string(),
      filter: z.string().optional().describe("JSON filter"),
    },
    async ({ database, collection, filter }) => {
      try {
        const c = await getClient();
        const count = await c
          .db(database)
          .collection(collection)
          .countDocuments(filter ? parseJSON(filter, "filter") : {});
        return ok({ count });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "aggregate",
    "Run an aggregation pipeline",
    {
      database: z.string(),
      collection: z.string(),
      pipeline: z
        .string()
        .describe(
          'JSON array of pipeline stages, e.g. [{"$group":{"_id":"$status"}}]',
        ),
    },
    async ({ database, collection, pipeline }) => {
      try {
        const c = await getClient();
        const result = await c
          .db(database)
          .collection(collection)
          .aggregate(parseJSON(pipeline, "pipeline"))
          .toArray();
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── Write ─────────────────────────────────────────────────────────────────

  server.tool(
    "insert_one",
    "Insert a single document",
    {
      database: z.string(),
      collection: z.string(),
      document: z.string().describe("JSON document"),
    },
    async ({ database, collection, document }) => {
      try {
        const c = await getClient();
        const r = await c
          .db(database)
          .collection(collection)
          .insertOne(parseJSON(document, "document"));
        return ok({ insertedId: r.insertedId, acknowledged: r.acknowledged });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "insert_many",
    "Insert multiple documents",
    {
      database: z.string(),
      collection: z.string(),
      documents: z.string().describe("JSON array of documents"),
    },
    async ({ database, collection, documents }) => {
      try {
        const c = await getClient();
        const r = await c
          .db(database)
          .collection(collection)
          .insertMany(parseJSON(documents, "documents"));
        return ok({
          insertedCount: r.insertedCount,
          insertedIds: r.insertedIds,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "update_one",
    "Update a single document",
    {
      database: z.string(),
      collection: z.string(),
      filter: z.string().describe("JSON filter"),
      update: z
        .string()
        .describe('JSON update, e.g. {"$set":{"status":"done"}}'),
      upsert: z.boolean().optional(),
    },
    async ({ database, collection, filter, update, upsert }) => {
      try {
        const c = await getClient();
        const r = await c
          .db(database)
          .collection(collection)
          .updateOne(parseJSON(filter, "filter"), parseJSON(update, "update"), {
            upsert: upsert ?? false,
          });
        return ok({
          matchedCount: r.matchedCount,
          modifiedCount: r.modifiedCount,
          upsertedId: r.upsertedId,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "update_many",
    "Update multiple documents",
    {
      database: z.string(),
      collection: z.string(),
      filter: z.string().describe("JSON filter"),
      update: z.string().describe("JSON update operation"),
      upsert: z.boolean().optional(),
    },
    async ({ database, collection, filter, update, upsert }) => {
      try {
        const c = await getClient();
        const r = await c
          .db(database)
          .collection(collection)
          .updateMany(
            parseJSON(filter, "filter"),
            parseJSON(update, "update"),
            { upsert: upsert ?? false },
          );
        return ok({
          matchedCount: r.matchedCount,
          modifiedCount: r.modifiedCount,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "delete_one",
    "Delete a single document",
    {
      database: z.string(),
      collection: z.string(),
      filter: z.string().describe("JSON filter"),
    },
    async ({ database, collection, filter }) => {
      try {
        const c = await getClient();
        const r = await c
          .db(database)
          .collection(collection)
          .deleteOne(parseJSON(filter, "filter"));
        return ok({ deletedCount: r.deletedCount });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "delete_many",
    "Delete multiple documents",
    {
      database: z.string(),
      collection: z.string(),
      filter: z.string().describe("JSON filter"),
    },
    async ({ database, collection, filter }) => {
      try {
        const c = await getClient();
        const r = await c
          .db(database)
          .collection(collection)
          .deleteMany(parseJSON(filter, "filter"));
        return ok({ deletedCount: r.deletedCount });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── Indexes ───────────────────────────────────────────────────────────────

  server.tool(
    "create_index",
    "Create an index on a collection",
    {
      database: z.string(),
      collection: z.string(),
      keys: z.string().describe('JSON key spec, e.g. {"email":1}'),
      options: z
        .string()
        .optional()
        .describe('JSON options, e.g. {"unique":true}'),
    },
    async ({ database, collection, keys, options }) => {
      try {
        const c = await getClient();
        const name = await c
          .db(database)
          .collection(collection)
          .createIndex(
            parseJSON(keys, "keys"),
            options ? parseJSON(options, "options") : {},
          );
        return ok({ indexName: name });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "get_indexes",
    "List indexes on a collection",
    { database: z.string(), collection: z.string() },
    async ({ database, collection }) => {
      try {
        const c = await getClient();
        return ok(await c.db(database).collection(collection).indexes());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "drop_collection",
    "Drop (delete) an entire collection — irreversible",
    { database: z.string(), collection: z.string() },
    async ({ database, collection }) => {
      try {
        const c = await getClient();
        return ok({
          dropped: await c.db(database).collection(collection).drop(),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── Schema inference ─────────────────────────────────────────────────────

  server.tool(
    "get_collection_schema",
    "Infer the schema of a collection by sampling documents. Returns field names, types, nesting, and how often each field appears.",
    {
      database: z.string(),
      collection: z.string(),
      sampleSize: z
        .number()
        .optional()
        .describe("Documents to sample (default 100, max 500)"),
    },
    async ({ database, collection, sampleSize }) => {
      try {
        const c = await getClient();
        const limit = Math.min(sampleSize ?? 100, 500);
        const docs = await c
          .db(database)
          .collection(collection)
          .find({})
          .limit(limit)
          .toArray();

        if (docs.length === 0) return ok({ schema: {}, totalSampled: 0 });

        function inferType(value) {
          if (value === null) return "null";
          if (Array.isArray(value)) return "array";
          const t = typeof value;
          if (t === "object") {
            if (
              value._bsontype === "ObjectId" ||
              value.constructor?.name === "ObjectId"
            )
              return "ObjectId";
            if (value instanceof Date) return "date";
            return "object";
          }
          return t; // string | number | boolean
        }

        function mergeSchema(schema, obj, prefix = "") {
          for (const [key, value] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (!schema[path])
              schema[path] = { types: {}, count: 0, nullable: false };

            schema[path].count += 1;

            const type = inferType(value);
            schema[path].types[type] = (schema[path].types[type] || 0) + 1;

            if (value === null) schema[path].nullable = true;

            // Recurse into nested objects (not arrays, to keep output readable)
            if (type === "object" && value !== null) {
              mergeSchema(schema, value, path);
            }

            // For arrays, describe element types
            if (type === "array" && value.length > 0) {
              const elemTypes = {};
              for (const item of value) {
                const et = inferType(item);
                elemTypes[et] = (elemTypes[et] || 0) + 1;
              }
              schema[path].arrayElementTypes = elemTypes;
            }
          }
        }

        const rawSchema = {};
        for (const doc of docs) mergeSchema(rawSchema, doc);

        // Build a clean summary
        const schema = {};
        for (const [path, info] of Object.entries(rawSchema)) {
          const dominantType = Object.entries(info.types).sort(
            (a, b) => b[1] - a[1],
          )[0][0];
          schema[path] = {
            type:
              Object.keys(info.types).length === 1 ? dominantType : info.types,
            presentIn: `${info.count}/${docs.length} docs (${Math.round((info.count / docs.length) * 100)}%)`,
            nullable: info.nullable || undefined,
            ...(info.arrayElementTypes
              ? { arrayElementTypes: info.arrayElementTypes }
              : {}),
          };
          if (!info.nullable) delete schema[path].nullable;
        }

        return ok({ schema, totalSampled: docs.length, collection, database });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── IP management ────────────────────────────────────────────────────────

  server.tool("list_allowed_ips", "List all whitelisted IPs", {}, async () => {
    return ok({ allowedIPs: loadConfig().allowedIPs });
  });

  server.tool(
    "add_allowed_ip",
    "Add an IP to the whitelist",
    {
      ip: z
        .string()
        .describe('IP address, e.g. 103.21.55.10  (use "*" to allow all)'),
    },
    async ({ ip }) => {
      const cfg = loadConfig();
      if (!cfg.allowedIPs.includes(ip)) cfg.allowedIPs.push(ip);
      saveConfig(cfg);
      return ok({ allowedIPs: cfg.allowedIPs });
    },
  );

  server.tool(
    "remove_allowed_ip",
    "Remove an IP from the whitelist",
    { ip: z.string() },
    async ({ ip }) => {
      const cfg = loadConfig();
      cfg.allowedIPs = cfg.allowedIPs.filter((i) => i !== ip);
      saveConfig(cfg);
      return ok({ allowedIPs: cfg.allowedIPs });
    },
  );

  // ── URI management ───────────────────────────────────────────────────────

  server.tool(
    "update_mongo_uri",
    "Update the MongoDB connection URI and reconnect (also saved to .env)",
    { uri: z.string().describe("New MongoDB connection URI") },
    async ({ uri }) => {
      try {
        await setMongoUri(uri);
        return ok({
          success: true,
          message: "URI updated, reconnected, and saved to .env",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "test_connection",
    "Ping MongoDB and confirm the current URI is working",
    {},
    async () => {
      try {
        const c = await getClient();
        const ping = await c.db().admin().ping();
        return ok({ connected: true, ping, uri: maskedUri() });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const MODE = process.env.MODE || "http";
const PORT = parseInt(process.env.PORT || "3000", 10);

if (MODE === "stdio") {
  // ── Stdio transport (for local Claude Desktop) ──────────────────────────
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("MongoDB MCP running in stdio mode\n");
} else {
  // ── HTTP + SSE transport (for remote devices) ───────────────────────────
  const app = express();
  app.use(express.json());

  function ipGuard(req, res, next) {
    const cfg = loadConfig();
    if (cfg.allowedIPs.includes("*")) return next();

    const forwarded = req.headers["x-forwarded-for"];
    const raw = forwarded
      ? forwarded.split(",")[0].trim()
      : req.socket.remoteAddress;
    const ip = (raw || "").replace(/^::ffff:/, "");

    if (ip === "127.0.0.1" || ip === "::1" || cfg.allowedIPs.includes(ip)) {
      return next();
    }
    console.warn(`[BLOCKED] ${ip} — not in whitelist`);
    res.status(403).json({ error: `Access denied for IP: ${ip}` });
  }

  const sessions = new Map();

  // MCP Streamable HTTP endpoint (new protocol — used by Claude Code)
  app.all("/mcp", ipGuard, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    if (sessionId && sessions.has(sessionId)) {
      transport = sessions.get(sessionId);
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const server = createServer();
      transport.onclose = () => sessions.delete(sessionId);
      await server.connect(transport);
      if (transport.sessionId) sessions.set(transport.sessionId, transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  // Legacy SSE endpoint (for older clients)
  app.get("/sse", ipGuard, async (_req, res) => {
    const server = createServer();
    const transport = new SSEServerTransport("/messages", res);
    sessions.set(transport.sessionId, { server, transport, legacy: true });
    res.on("close", () => sessions.delete(transport.sessionId));
    await server.connect(transport);
  });

  app.post("/messages", ipGuard, async (req, res) => {
    const session = sessions.get(req.query.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    await session.transport.handlePostMessage(req, res);
  });

  // Health check (no IP guard — safe read-only)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      activeSessions: sessions.size,
      mongoUri: maskedUri(),
      allowedIPs: loadConfig().allowedIPs,
    });
  });

  // ── Admin REST endpoints (IP guard applied) ────────────────────────────

  app.get("/admin/ips", ipGuard, (_req, res) => res.json(loadConfig()));

  app.post("/admin/ips/add", ipGuard, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: "ip required" });
    const cfg = loadConfig();
    if (!cfg.allowedIPs.includes(ip)) cfg.allowedIPs.push(ip);
    saveConfig(cfg);
    res.json({ success: true, allowedIPs: cfg.allowedIPs });
  });

  app.post("/admin/ips/remove", ipGuard, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: "ip required" });
    const cfg = loadConfig();
    cfg.allowedIPs = cfg.allowedIPs.filter((i) => i !== ip);
    saveConfig(cfg);
    res.json({ success: true, allowedIPs: cfg.allowedIPs });
  });

  app.post("/admin/mongo-uri", ipGuard, async (req, res) => {
    const { uri } = req.body;
    if (!uri) return res.status(400).json({ error: "uri required" });
    try {
      await setMongoUri(uri);
      res.json({
        success: true,
        message: "MongoDB URI updated and reconnected",
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    const cfg = loadConfig();
    console.log(`
╔══════════════════════════════════════════════════════╗
║           MongoDB MCP Server — Ready                 ║
╠══════════════════════════════════════════════════════╣
║  MCP (SSE)  →  http://YOUR_IP:${PORT}/sse             ║
║  Health     →  http://YOUR_IP:${PORT}/health          ║
║  Admin IPs  →  http://YOUR_IP:${PORT}/admin/ips       ║
╚══════════════════════════════════════════════════════╝
  Port        : ${PORT}
  MongoDB     : ${maskedUri()}
  Allowed IPs : ${cfg.allowedIPs.join(", ")}

  To allow a new device, call the MCP tool  add_allowed_ip
  or POST { "ip": "x.x.x.x" } to /admin/ips/add
`);
  });
}
