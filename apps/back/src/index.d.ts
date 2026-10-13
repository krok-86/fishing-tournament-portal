/**
 * Точка обмена уловами периода. Данные живут в памяти процесса:
 * перезапуск сервера их стирает, постоянной базы здесь нет.
 */
export declare const inMemoryMatches: Record<string, any>;
interface MatchApp {
    post(path: string, handler: (req: {
        body?: unknown;
    }, res: MatchResponse) => void): void;
    get(path: string, handler: (req: unknown, res: MatchResponse) => void): void;
}
interface MatchResponse {
    status(code: number): {
        json(body: unknown): void;
    };
    json(body: unknown): void;
}
export declare function attachMatchRoutes(app: MatchApp): void;
export {};
