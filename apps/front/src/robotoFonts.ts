import robotoBold from "./fonts/Roboto-Bold.ttf?inline";
import robotoRegular from "./fonts/Roboto-Regular.ttf?inline";

/** Кириллица в бланке PDF. Шрифт вшит в скрипт: отдельный запрос .ttf на сайте обрывается, и файл не собирается. */
export function embeddedRoboto(): { regular: string; bold: string } {
  return {
    regular: fontBase64(robotoRegular),
    bold: fontBase64(robotoBold),
  };
}

function fontBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.startsWith("data:")) throw new Error("Шрифт карточек не загрузился");
  return dataUrl.slice(comma + 1);
}
