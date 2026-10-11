import { create } from "zustand";
import { useMatchStore } from "./store.ts";
const VISIBLE_MS = 3800;
const MAX_TOASTS = 3;
let nextId = 1;
export const useToasts = create((set, get) => ({
    items: [],
    push(tone, text) {
        const id = nextId;
        nextId += 1;
        set({ items: [...get().items, { id, tone, text }].slice(-MAX_TOASTS) });
        window.setTimeout(() => get().dismiss(id), VISIBLE_MS);
    },
    dismiss(id) {
        set({ items: get().items.filter((item) => item.id !== id) });
    },
}));
export function toast(tone, text) {
    useToasts.getState().push(tone, text);
}
export async function confirmAndToast(confirmPeriod) {
    const before = useMatchStore.getState();
    await confirmPeriod();
    const after = useMatchStore.getState();
    if (after.error) {
        toast("err", after.error);
        return;
    }
    const changed = after.period !== before.period ||
        after.confirmed !== before.confirmed ||
        after.savedCount !== before.savedCount ||
        after.playoffEntryOpen !== before.playoffEntryOpen;
    if (!changed)
        return;
    toast("ok", before.playoff.formed ? "Дуэль сохранена" : `Период ${before.period} сохранён`);
}
