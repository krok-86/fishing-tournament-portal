export type ToastTone = "ok" | "err";
type ToastItem = {
    id: number;
    tone: ToastTone;
    text: string;
};
type ToastStore = {
    items: readonly ToastItem[];
    push: (tone: ToastTone, text: string) => void;
    dismiss: (id: number) => void;
};
export declare const useToasts: import("zustand").UseBoundStore<import("zustand").StoreApi<ToastStore>>;
export declare function toast(tone: ToastTone, text: string): void;
export declare function confirmAndToast(confirmPeriod: () => Promise<void>): Promise<void>;
export {};
