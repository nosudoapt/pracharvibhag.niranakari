// lib/neon-connection.js
// Small wrapper around @neondatabase/serverless that forces database
// connections over IPv4.
//
// Why: on some networks IPv6 to the Neon endpoint is black-holed while IPv4
// connects in ~300ms. Node's global fetch prefers IPv6 and hangs with
// UND_ERR_CONNECT_TIMEOUT even though the endpoint is perfectly reachable.
// A custom https request with `family: 4` sidesteps that entirely. It is
// harmless in normal environments — it simply always uses IPv4.
import https from "https";
import { neon, neonConfig } from "@neondatabase/serverless";

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  neonConfig.fetchFunction = function ipv4Fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const u = new URL(url);
        const req = https.request(
          {
            hostname: u.hostname,
            family: 4,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: options.method || "GET",
            headers: options.headers || {},
          },
          (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }));
            });
          }
        );
        req.on("error", reject);
        if (options.body) req.write(options.body);
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  };
}

export function makeNeon(connectionString) {
  install();
  return neon(connectionString);
}
