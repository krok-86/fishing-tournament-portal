import fs from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
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
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: ["favicon.svg", "icons.svg"],
      manifest: {
        name: "Сектор — карточка участника",
        short_name: "Сектор",
        description: "Ввод поимок рыболовного турнира без сети",
        lang: "ru",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#020617",
        theme_color: "#020617",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico,png,webmanifest,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackAllowlist: [/^\//],
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
        navigateFallbackAllowlist: [/^\//],
      },
    }),
  ],
  server: {
    // Документация и закладки организатора завязаны на этот порт.
    port: 5174,
    strictPort: true,
    // Телефон в той же Wi‑Fi открывает ноутбук по адресу 192.168.x.x, не по localhost.
    host: true,
    ...(https ? { https } : {}),
    // Заявка игрока и импорт орга идут на тот же адрес, что и страница. Бэкенд — apps/back.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
