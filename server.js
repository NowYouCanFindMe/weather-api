const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = process.env.PORT || 8989;
const ROOT = process.cwd();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const loadEnvFile = () => {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  contents.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, ...rest] = trimmed.split("=");
    if (!key) return;
    const value = rest.join("=").trim();
    if (!process.env[key]) {
      process.env[key] = value.replace(/^"(.*)"$/, "$1");
    }
  });
};

loadEnvFile();

const getApiKey = () => process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;

const respondJson = (res, status, payload) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
};

const parseJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });

const callOpenAI = (payload) =>
  new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      reject(new Error("OPEN_AI_KEY is missing in .env"));
      return;
    }
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        method: "POST",
        hostname: "api.openai.com",
        path: "/v1/responses",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`OpenAI error (${res.statusCode}): ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });

const extractOutputText = (response) => {
  if (!response) return "";
  if (typeof response.output_text === "string") {
    return response.output_text;
  }
  if (!Array.isArray(response.output)) return "";
  let text = "";
  response.output.forEach((item) => {
    if (!item) return;
    if (item.type === "message" && Array.isArray(item.content)) {
      item.content.forEach((part) => {
        if (!part) return;
        if (part.type === "output_text" || part.type === "text") {
          text += part.text || "";
        }
      });
    }
    if (item.type === "output_text" && item.text) {
      text += item.text;
    }
  });
  return text.trim();
};

const buildPrompt = (weather) => {
  const tempLine = `${weather.temperature} ${weather.temperatureUnit}`;
  const feelsLine = `${weather.feelsLike} ${weather.temperatureUnit}`;
  const windLine = `${weather.windSpeed} ${weather.windUnit} ${weather.windDirection}`;

  return [
    "Weather details:",
    `Summary: ${weather.summary}`,
    `Temperature: ${tempLine}`,
    `Feels like: ${feelsLine}`,
    `Humidity: ${weather.humidity}%`,
    `Wind: ${windLine}`,
    `Location: ${weather.location}`,
    `Local time: ${weather.time} (${weather.timezone})`,
  ].join("\n");
};

const serveFile = (req, res) => {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, decodeURIComponent(urlPath));

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/suggest" && req.method === "POST") {
    console.log("Received /api/suggest request");
    try {
      const body = await parseJsonBody(req);
      console.log("Parsed request body:", body);
      if (!body || !body.weather) {
        respondJson(res, 400, { error: "Missing weather details." });
        return;
      }
      const prompt = buildPrompt(body.weather);
      console.log("Generated prompt for OpenAI:\n", prompt);
      const response = await callOpenAI({
        model: "gpt-4o-mini",
        instructions:
          "You are a concise stylist. Suggest what to wear given the weather. Return exactly 4 bullet lines in this format: **Base Layer**: ... **Mid Layer**: ... **Outer Layer**: ... **Accessories**: ... Keep each line short. Avoid medical advice.",
        input: prompt,
      });
      const suggestion = extractOutputText(response);
      if (!suggestion) {
        respondJson(res, 500, { error: "No suggestion returned." });
        return;
      }
      respondJson(res, 200, { suggestion });
      return;
    } catch (err) {
      respondJson(res, 500, { error: err.message || "Server error." });
      return;
    }
  }

  serveFile(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`http://localhost:${PORT}`);
});
