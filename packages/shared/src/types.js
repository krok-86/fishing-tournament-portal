/**
 * PAL Trout 2026, групповая стадия.
 * Очки одного спортсмена за период — чистая функция его поимок и поимок соперника:
 *   own === 0            → 0   (0:0 и сухой проигрыш 0:3)
 *   own > opponent       → 4
 *   own === opponent > 0 → 2   (2:2, 5:5)
 *   0 < own < opponent   → 1   (в 2:4 сторона с двумя рыбами)
 * Ноль поимок всегда 0, даже если это поражение.
 */
/** Отбор PAL Trout: восемь периодов, затем плей-офф топ-8. */
export const QUALIFYING_PERIOD_COUNT = 8;
export const QUALIFYING_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
export const PLAYOFF_FIELD = 8;
