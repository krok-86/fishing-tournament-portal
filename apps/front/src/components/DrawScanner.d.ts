export declare function DrawScanner({ title, hint, onCode, onClose, }: {
    title: string;
    hint: string;
    onCode: (raw: string) => Promise<string | null>;
    onClose: () => void;
}): import("react").JSX.Element;
