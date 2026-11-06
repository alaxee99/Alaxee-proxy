import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const apiRoot = "https://api.addons.microsoftedge.microsoft.com/v1";
const productId = process.env.EDGE_ADDONS_PRODUCT_ID;
const clientId = process.env.EDGE_ADDONS_CLIENT_ID;
const apiKey = process.env.EDGE_ADDONS_API_KEY;
const packagePath = process.argv[2];
const notes = process.env.EDGE_ADDONS_PUBLISH_NOTES || "Automated Alaxee Proxy release.";

for (const [name, value] of Object.entries({
  EDGE_ADDONS_PRODUCT_ID: productId,
  EDGE_ADDONS_CLIENT_ID: clientId,
  EDGE_ADDONS_API_KEY: apiKey,
  packagePath,
})) {
  if (!value) throw new Error(`Missing required input: ${name}`);
}

if (!/^[0-9a-f-]{36}$/i.test(productId)) {
  throw new Error("EDGE_ADDONS_PRODUCT_ID must be a GUID copied from Partner Center.");
}

const headers = {
  Authorization: `ApiKey ${apiKey}`,
  "X-ClientID": clientId,
};

async function readResponse(response, label) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${text.slice(0, 2000)}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 1000)}`);
  }
}

function operationIdFrom(response, label) {
  const location = response.headers.get("location");
  if (!location) throw new Error(`${label} returned no Location header; cannot track operation.`);
  const operationId = location.replace(/\/+$/, "").split("/").at(-1);
  if (!operationId || !/^[a-z0-9-]+$/i.test(operationId)) {
    throw new Error(`${label} returned an unexpected operation Location header.`);
  }
  return operationId;
}

async function waitForOperation(url, label) {
  const maxAttempts = 60;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { headers });
    const result = await readResponse(response, `${label} status check`);
    const status = String(result.status || "").toLowerCase();
    console.log(`${label}: ${result.status || "unknown"} (${attempt}/${maxAttempts})`);

    if (status === "succeeded" || status === "success" || status === "completed") return result;
    if (status === "failed" || status === "error" || status === "canceled" || status === "cancelled") {
      throw new Error(`${label} failed: ${result.message || result.errorCode || JSON.stringify(result.errors || result)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`${label} did not finish within 5 minutes. Check the operation in Partner Center before retrying.`);
}

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const archive = await readFile(packagePath);
console.log(`Submitting ${basename(packagePath)} (extension version ${manifest.version})`);

const uploadResponse = await fetch(`${apiRoot}/products/${productId}/submissions/draft/package`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/zip" },
  body: archive,
});
if (uploadResponse.status !== 202) await readResponse(uploadResponse, "Package upload");
else await uploadResponse.arrayBuffer();
const uploadOperationId = operationIdFrom(uploadResponse, "Package upload");
await waitForOperation(
  `${apiRoot}/products/${productId}/submissions/draft/package/operations/${uploadOperationId}`,
  "Package upload",
);

const publishResponse = await fetch(`${apiRoot}/products/${productId}/submissions`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ notes: `${notes} Version ${manifest.version}.` }),
});
if (publishResponse.status !== 202) await readResponse(publishResponse, "Publish submission");
else await publishResponse.arrayBuffer();
const publishOperationId = operationIdFrom(publishResponse, "Publish submission");
await waitForOperation(
  `${apiRoot}/products/${productId}/submissions/operations/${publishOperationId}`,
  "Publish submission",
);

console.log(`Submitted Alaxee Proxy ${manifest.version} to Microsoft Edge Add-ons for certification.`);
console.log("Microsoft's review and store rollout are separate from this successful API submission.");
