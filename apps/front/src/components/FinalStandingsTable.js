export function FinalStandingsTable({ rows }) {
    return (<section className="mt-16" aria-label="Итоговая таблица турнира">
      <div className="mb-3">
        <h3 className="text-lg font-black tracking-tight sm:text-2xl">Итоговая таблица</h3>
        <p className="text-xs text-slate-400 sm:text-sm">
          Места с 1-го по последнее. Поимки — сумма за отбор, без кубковых дуэлей.
        </p>
      </div>
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-slate-950 shadow-xl shadow-black/30">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="bg-slate-900 text-[10px] tracking-wide text-slate-400 uppercase sm:text-xs">
            <tr>
              <th className="w-24 px-4 py-3 font-semibold">Итоговое место</th>
              <th className="w-20 px-3 py-3 font-semibold">Номер</th>
              <th className="px-3 py-3 font-semibold">ФИО</th>
              <th className="w-36 px-3 py-3 text-right font-semibold">Всего поимок за отбор</th>
              <th className="w-48 px-4 py-3 font-semibold">Максимальная стадия плей-офф</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (<tr key={row.slotId} className={`border-t border-white/10 ${rowTint(row.place)}`}>
                <td className="px-4 py-3 text-lg font-black tabular-nums">{row.place}</td>
                <td className="px-3 py-3 font-bold tabular-nums text-cyan-100">{row.bibNumber}</td>
                <td className="px-3 py-3 text-base font-bold">{row.displayName}</td>
                <td className="px-3 py-3 text-right text-base font-black tabular-nums">{row.qualifyingFish}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black tracking-wide uppercase ${stageClass(row.stage)}`}>
                    {row.stage}
                  </span>
                </td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </section>);
}
function rowTint(place) {
    if (place === 1)
        return "bg-amber-300/15";
    if (place === 2)
        return "bg-slate-200/10";
    if (place === 3)
        return "bg-orange-700/20";
    return "";
}
function stageClass(stage) {
    if (stage === "Чемпион")
        return "bg-amber-300 text-slate-950";
    if (stage === "Финалист")
        return "bg-slate-200 text-slate-950";
    if (stage === "3-е место")
        return "bg-orange-700 text-orange-50";
    if (stage === "4-е место")
        return "bg-orange-950 text-orange-100";
    if (stage === "1/4 финала")
        return "bg-cyan-300/15 text-cyan-50";
    return "bg-white/10 text-slate-200";
}
