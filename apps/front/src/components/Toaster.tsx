import { useToasts } from "../toast.ts";

export function Toaster() {
  const items = useToasts((state) => state.items);
  const dismiss = useToasts((state) => state.dismiss);
  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-3"
      aria-live="polite"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`toast-in pointer-events-auto w-full max-w-lg rounded-2xl px-4 py-3 text-left text-sm font-bold shadow-lg shadow-black/40 ${
            item.tone === "ok" ? "bg-emerald-400 text-slate-950" : "bg-rose-500 text-white"
          }`}
          onClick={() => dismiss(item.id)}
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}
