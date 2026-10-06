import fs from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ServerOptions } from "vite";

/** Телефон отдаёт камеру только защищённой странице. Сертификат включается парой DEV_HTTPS_CERT / DEV_HTTPS_KEY. */
function devHttps(): ServerOptions["https"] {
  const certPath = process.env.DEV_HTTPS_CERT;
  const keyPath = process.env.DEV_HTTPS_KEY;
  if (!certPath || !keyPath) return undefined;
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

const https = devHttps();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  ...(https ? { server: { https } } : {}),
});
