export declare function DrawScanner({ title, hint, onCode, onClose, placeholder, }: {
    title: string;
    hint: string;
    onCode: (raw: string) => Promise<string | null>;
    onClose: () => void;
    placeholder?: string;
}): import("react").JSX.Element;
