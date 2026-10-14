/**
 * Адрес API.
 * Локально база пустая: Vite проксирует `/api` на Express.
 * На Vercel в сборку попадает `VITE_API_URL` — публичный URL бэкенда на Render, без слэша в конце.
 */
export function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_API_URL;
  const base = typeof configured === "string" ? configured.trim().replace(/\/+$/, "") : "";
  return `${base}${path}`;
}
