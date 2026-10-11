import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { TournamentArchiveSnapshot } from "../../../../packages/shared/src/archive.ts";
import { playoffMatches, previewPlayoffScore, scorePlayoffDuel } from "../../../../packages/shared/src/calculator.ts";
import { buildFinalStandings } from "../../../../packages/shared/src/finalStandings.ts";
import type { PlayoffBracketMatch, PlayoffStage, PlayoffTieBreak } from "../../../../packages/shared/src/types.ts";
import { useMatchStore } from "../store.ts";
import { confirmAndToast, toast } from "../toast.ts";
import { FinalStandingsTable } from "./FinalStandingsTable.tsx";
import { Podium } from "./Podium.tsx";

export function playoffStageTitle(stage: PlayoffStage): string {
  if (stage === "quarterfinal") return "1/4 финала";
  if (stage === "semifinal") return "1/2 финала";
  if (stage === "third") return "Матч за 3-е место";
  return "Финал";
}

function waitingName(stage: PlayoffStage): string {
  if (stage === "third") return "Проигравший полуфинала";
  if (stage === "final") return "Победитель полуфинала";
  if (stage === "semifinal") return "Победитель четвертьфинала";
  return "Победитель пары";
}

function overtimeMarker(decidedBy: PlayoffTieBreak | null): string | null {
  if (decidedBy === "extraTime") return "победа в доп. время";
  if (decidedBy === "goldenFish") return "победа по золотой рыбе";
  if (decidedBy === "qualifyingPlace") return "по рейтингу группы";
  return null;
}

export function PlayoffBracket({
  snapshot = null,
  onArchive,
  archiving = false,
  archiveUrl = null,
}: {
  /** Готовый снимок архива. Живой турнир читается из журнала на телефоне. */
  snapshot?: TournamentArchiveSnapshot | null;
  onArchive?: () => void;
  archiving?: boolean;
  archiveUrl?: string | null;
} = {}) {
  const stored = useMatchStore((state) => state.playoff);
  const participants = useMatchStore((state) => state.participants);
  const leaderboard = useMatchStore((state) => state.leaderboard);
  const tournamentName = useMatchStore((state) => state.tournamentName);
  const tournamentDate = useMatchStore((state) => state.tournamentDate);
  const playoffEntryOpen = useMatchStore((state) => state.playoffEntryOpen);
  const selectedPlayoffMatchId = useMatchStore((state) => state.selectedPlayoffMatchId);
  const athleteFish = useMatchStore((state) => state.athleteFish);
  const opponentFish = useMatchStore((state) => state.opponentFish);
  const athleteExtraFish = useMatchStore((state) => state.athleteExtraFish);
  const opponentExtraFish = useMatchStore((state) => state.opponentExtraFish);
  const athleteGoldenFish = useMatchStore((state) => state.athleteGoldenFish);
  const opponentGoldenFish = useMatchStore((state) => state.opponentGoldenFish);
  const goldenFirst = useMatchStore((state) => state.goldenFirst);
  const playoffDraftActive = useMatchStore((state) => state.playoffDraftActive);
  const confirmed = useMatchStore((state) => state.confirmed);
  const openPlayoffEntry = useMatchStore((state) => state.openPlayoffEntry);

  const drafting = !snapshot && playoffEntryOpen && !confirmed && playoffDraftActive;
  const playoff = snapshot
    ? snapshot.playoff
    : drafting
      ? previewPlayoffScore(stored, selectedPlayoffMatchId, {
          fishA: athleteFish,
          fishB: opponentFish,
          extraFishA: athleteExtraFish,
          extraFishB: opponentExtraFish,
          goldenFishA: athleteGoldenFish,
          goldenFishB: opponentGoldenFish,
          goldenFirst,
        })
      : stored;
  const people = snapshot ? snapshot.participants : participants;
  const standings = snapshot
    ? snapshot.finalStandings
    : buildFinalStandings({ playoff: stored, leaderboard, participants });
  const ceremonyName = snapshot?.tournament.name ?? tournamentName;
  const ceremonyDate = snapshot?.tournament.date ?? tournamentDate;
  const champion = standings?.find((row) => row.place === 1) ?? null;
  const finalist = standings?.find((row) => row.place === 2) ?? null;
  const bronzeMedalist = standings?.find((row) => row.place === 3) ?? null;
  const crowned = champion && finalist && bronzeMedalist ? { champion, finalist, third: bronzeMedalist } : null;

  if (
    !playoff.formed ||
    !playoff.final ||
    !playoff.thirdPlace ||
    playoff.quarterfinals.length < 4 ||
    playoff.semifinals.length < 2
  ) {
    return null;
  }

  const nameOf = (slotId: string | null, stage: PlayoffStage) => {
    if (!slotId) return waitingName(stage);
    const person = people.find((participant) => participant.slotId === slotId);
    return person ? `${person.bibNumber}. ${person.displayName}` : "—";
  };
  const quarter = playoff.quarterfinals;
  const semi = playoff.semifinals;
  const activeMatchId = snapshot || !playoffEntryOpen ? "" : selectedPlayoffMatchId;
  const openMatch = (match: PlayoffBracketMatch) => {
    if (snapshot || !match.slotIdA || !match.slotIdB) return undefined;
    return () => openPlayoffEntry(match.matchId);
  };
  const podium = crowned ? (
    <div className="mb-8">
      <Podium
        champion={crowned.champion}
        finalist={crowned.finalist}
        third={crowned.third}
        tournamentName={ceremonyName}
        tournamentDate={ceremonyDate}
      />
    </div>
  ) : null;

  return (
    <section className="mt-6" aria-label="Сетка плей-офф">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-black tracking-tight sm:text-2xl">Плей-офф</h2>
          <p className="text-xs text-slate-400 sm:text-sm">
            1/4, 1/2, финал и матч за 3-е место. Ничья основного времени решается доп. 5-минуткой, затем «Золотой рыбой», и только потом рейтингом группы.
          </p>
        </div>
        <p className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-[11px] font-bold tracking-wide text-cyan-100 uppercase">
          На выбывание
        </p>
      </div>

      {podium}

      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-slate-950/80 p-3 shadow-xl shadow-black/30 sm:p-6">
        <div className="flex min-w-[70rem] items-center pb-16">
          <div className="flex flex-1 flex-col gap-10">
            <BracketHalf
              left={[quarter[0]!, quarter[3]!]}
              right={semi[0]!}
              nameOf={nameOf}
              activeMatchId={activeMatchId}
              openMatch={openMatch}
            />
            <BracketHalf
              left={[quarter[1]!, quarter[2]!]}
              right={semi[1]!}
              nameOf={nameOf}
              activeMatchId={activeMatchId}
              openMatch={openMatch}
            />
          </div>
          <BracketJoin />
          <div className="relative w-80 shrink-0">
            <MatchCard
              match={playoff.final}
              nameOf={nameOf}
              featured
              active={activeMatchId === playoff.final.matchId}
              onOpen={openMatch(playoff.final)}
            />
            {/* Малый финал сидит под главным и не растягивает колонку, чтобы линия сетки целилась в финал. */}
            <div className="absolute top-[calc(100%+1.25rem)] right-0 left-0">
              <p className="mb-2 text-center text-[11px] font-black tracking-[0.2em] text-amber-200 uppercase">Малый финал</p>
              <MatchCard
                match={playoff.thirdPlace}
                nameOf={nameOf}
                bronze
                active={activeMatchId === playoff.thirdPlace.matchId}
                onOpen={openMatch(playoff.thirdPlace)}
              />
            </div>
          </div>
        </div>
      </div>

      {standings && standings.length > 0 && <FinalStandingsTable rows={standings} />}

      {crowned && onArchive && (
        <div className="mt-6">
          <button
            type="button"
            className={`h-14 w-full rounded-2xl text-base font-black tracking-wide ${
              archiving
                ? "bg-slate-700 text-slate-400"
                : "bg-gradient-to-r from-amber-200 via-amber-400 to-orange-400 text-slate-950"
            }`}
            disabled={archiving}
            onClick={onArchive}
          >
            {archiving ? "Отправляем в архив..." : "Завершить и архивировать турнир"}
          </button>
          {archiveUrl && (
            <p className="mt-3 text-center text-sm text-slate-300">
              Вечная страница итогов:{" "}
              <a className="font-bold break-all text-cyan-200 underline" href={archiveUrl}>
                {archiveUrl}
              </a>
            </p>
          )}
        </div>
      )}
      {!snapshot && !crowned && (
        <p className="mt-4 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-300">
          Подиум, итоговая таблица и кнопка «Завершить и архивировать турнир» появятся, когда будут сыграны финал и матч за 3-е место.
        </p>
      )}
    </section>
  );
}

const NAME_REQUIRED = "Выберите номер и введите ФИО";

export function PlayoffEntryDialog({ organizer = false }: { organizer?: boolean } = {}) {
  const open = useMatchStore((state) => state.playoffEntryOpen);
  const playoff = useMatchStore((state) => state.playoff);
  const participants = useMatchStore((state) => state.participants);
  const selectedPlayoffMatchId = useMatchStore((state) => state.selectedPlayoffMatchId);
  const athleteName = useMatchStore((state) => state.athleteName);
  const opponentName = useMatchStore((state) => state.opponentName);
  const athleteFish = useMatchStore((state) => state.athleteFish);
  const opponentFish = useMatchStore((state) => state.opponentFish);
  const athleteExtraFish = useMatchStore((state) => state.athleteExtraFish);
  const opponentExtraFish = useMatchStore((state) => state.opponentExtraFish);
  const athleteGoldenFish = useMatchStore((state) => state.athleteGoldenFish);
  const opponentGoldenFish = useMatchStore((state) => state.opponentGoldenFish);
  const goldenFirst = useMatchStore((state) => state.goldenFirst);
  const saving = useMatchStore((state) => state.saving);
  const confirmed = useMatchStore((state) => state.confirmed);
  const error = useMatchStore((state) => state.error);
  const adjustFish = useMatchStore((state) => state.adjustFish);
  const adjustPlayoffLine = useMatchStore((state) => state.adjustPlayoffLine);
  const setGoldenFirst = useMatchStore((state) => state.setGoldenFirst);
  const confirmPeriod = useMatchStore((state) => state.confirmPeriod);
  const closePlayoffEntry = useMatchStore((state) => state.closePlayoffEntry);
  const [regulationReadyId, setRegulationReadyId] = useState("");

  useEffect(() => {
    if (!organizer || !open) return;
    if (useMatchStore.getState().error === NAME_REQUIRED) useMatchStore.setState({ error: null });
  }, [organizer, open]);

  const match = playoffMatches(playoff).find((item) => item.matchId === selectedPlayoffMatchId);
  if (!open || !match?.slotIdA || !match.slotIdB || match.placeA === null || match.placeB === null || match.seedA === null || match.seedB === null) {
    return null;
  }

  const athlete = participants.find((participant) => participant.slotId === match.slotIdA);
  const opponent = participants.find((participant) => participant.slotId === match.slotIdB);
  const athleteTitle = athlete ? `${athlete.bibNumber}. ${athlete.displayName}` : athleteName;
  const opponentTitle = opponent ? `${opponent.bibNumber}. ${opponent.displayName}` : opponentName;
  const athletePerson = athlete?.displayName ?? athleteTitle;
  const opponentPerson = opponent?.displayName ?? opponentTitle;
  const regulationReady = regulationReadyId === match.matchId || match.winnerSlotId !== null || confirmed;
  const regulationTied = athleteFish === opponentFish;
  const extraTied = athleteExtraFish === opponentExtraFish;
  const goldenTied = athleteGoldenFish === opponentGoldenFish;
  const showExtra = regulationReady && regulationTied;
  const showGolden = showExtra && extraTied;
  const showRanking = showGolden && athleteGoldenFish === 0 && opponentGoldenFish === 0;
  const needsFirst = showGolden && goldenTied && athleteGoldenFish > 0 && goldenFirst === null;
  const decision = scorePlayoffDuel({
    fishA: athleteFish,
    fishB: opponentFish,
    extraFishA: athleteExtraFish,
    extraFishB: opponentExtraFish,
    goldenFishA: athleteGoldenFish,
    goldenFishB: opponentGoldenFish,
    goldenFirst,
    placeA: match.placeA,
    seedA: match.seedA,
    placeB: match.placeB,
    seedB: match.seedB,
  });
  const winnerName = decision.winner === "a" ? athletePerson : decision.winner === "b" ? opponentPerson : "";
  const ranking = scorePlayoffDuel({
    fishA: 0,
    fishB: 0,
    placeA: match.placeA,
    seedA: match.seedA,
    placeB: match.placeB,
    seedB: match.seedB,
  });
  const rankingName = ranking.winner === "a" ? athletePerson : ranking.winner === "b" ? opponentPerson : "";
  const visibleError = organizer && error === NAME_REQUIRED ? null : error;
  const markRegulation = () => setRegulationReadyId(match.matchId);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <section
        role="dialog"
        aria-labelledby="playoff-entry-title"
        className="pointer-events-auto mx-auto max-h-[min(92dvh,44rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-cyan-300/40 bg-slate-900 p-4 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-cyan-200 uppercase">Поимки этапа</p>
            <h2 id="playoff-entry-title" className="text-xl font-black">
              {playoffStageTitle(match.stage)}
            </h2>
          </div>
          <button
            type="button"
            className="h-10 rounded-xl px-3 text-sm font-bold text-slate-300"
            onClick={closePlayoffEntry}
            disabled={saving}
          >
            Закрыть
          </button>
        </div>

        <p className="mt-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Основное время</p>
        <div className="mt-2 grid gap-2">
          <CatchRow
            slotId={match.slotIdA}
            bibNumber={athlete?.bibNumber ?? 0}
            displayName={athlete?.displayName ?? athleteTitle}
            place={match.placeA}
            count={athleteFish}
            disabled={saving}
            canRename={organizer && athlete !== undefined}
            onPlus={() => {
              markRegulation();
              adjustFish("athlete", 1);
            }}
            onMinus={() => {
              markRegulation();
              adjustFish("athlete", -1);
            }}
          />
          <CatchRow
            slotId={match.slotIdB}
            bibNumber={opponent?.bibNumber ?? 0}
            displayName={opponent?.displayName ?? opponentTitle}
            place={match.placeB}
            count={opponentFish}
            disabled={saving}
            canRename={organizer && opponent !== undefined}
            onPlus={() => {
              markRegulation();
              adjustFish("opponent", 1);
            }}
            onMinus={() => {
              markRegulation();
              adjustFish("opponent", -1);
            }}
          />
        </div>

        {!regulationReady && regulationTied && (
          <button
            type="button"
            className="mt-3 w-full rounded-2xl bg-amber-300/15 px-3 py-2 text-left text-sm font-semibold text-amber-50"
            onClick={markRegulation}
          >
            Равный счет. Введите результат дополнительной 5-минутки
          </button>
        )}

        {regulationReady && !regulationTied && winnerName && (
          <p className="mt-3 rounded-2xl bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-50">
            Дальше проходит {winnerName} по основному времени.
          </p>
        )}

        <Reveal open={showExtra}>
          <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-3">
            <p className="text-sm font-semibold text-amber-50">Равный счет. Введите результат дополнительной 5-минутки</p>
            <div className="mt-2 grid gap-2">
              <CatchRow
                slotId={match.slotIdA}
                bibNumber={athlete?.bibNumber ?? 0}
                displayName={athletePerson}
                place={match.placeA}
                count={athleteExtraFish}
                disabled={saving}
                canRename={false}
                onPlus={() => adjustPlayoffLine("extra", "athlete", 1)}
                onMinus={() => adjustPlayoffLine("extra", "athlete", -1)}
              />
              <CatchRow
                slotId={match.slotIdB}
                bibNumber={opponent?.bibNumber ?? 0}
                displayName={opponentPerson}
                place={match.placeB}
                count={opponentExtraFish}
                disabled={saving}
                canRename={false}
                onPlus={() => adjustPlayoffLine("extra", "opponent", 1)}
                onMinus={() => adjustPlayoffLine("extra", "opponent", -1)}
              />
            </div>
            {!extraTied && winnerName && (
              <p className="mt-2 text-sm font-semibold text-amber-50">Дальше проходит {winnerName}: победа в доп. время.</p>
            )}
          </div>
        </Reveal>

        <Reveal open={showGolden}>
          <div className="rounded-2xl border border-yellow-200/40 bg-yellow-200/10 p-3">
            <p className="text-sm font-semibold text-yellow-50">Ничья в овертайме. Введите результат игры "Золотая рыба"</p>
            <div className="mt-2 grid gap-2">
              <CatchRow
                slotId={match.slotIdA}
                bibNumber={athlete?.bibNumber ?? 0}
                displayName={athletePerson}
                place={match.placeA}
                count={athleteGoldenFish}
                disabled={saving}
                canRename={false}
                onPlus={() => adjustPlayoffLine("golden", "athlete", 1)}
                onMinus={() => adjustPlayoffLine("golden", "athlete", -1)}
              />
              <CatchRow
                slotId={match.slotIdB}
                bibNumber={opponent?.bibNumber ?? 0}
                displayName={opponentPerson}
                place={match.placeB}
                count={opponentGoldenFish}
                disabled={saving}
                canRename={false}
                onPlus={() => adjustPlayoffLine("golden", "opponent", 1)}
                onMinus={() => adjustPlayoffLine("golden", "opponent", -1)}
              />
            </div>
            {goldenTied && athleteGoldenFish > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded-xl px-2 py-2 text-sm font-bold ${goldenFirst === "a" ? "bg-yellow-200 text-slate-950" : "bg-slate-950 text-yellow-50"}`}
                  aria-pressed={goldenFirst === "a"}
                  onClick={() => setGoldenFirst("a")}
                >
                  Первым поймал {athletePerson}
                </button>
                <button
                  type="button"
                  className={`rounded-xl px-2 py-2 text-sm font-bold ${goldenFirst === "b" ? "bg-yellow-200 text-slate-950" : "bg-slate-950 text-yellow-50"}`}
                  aria-pressed={goldenFirst === "b"}
                  onClick={() => setGoldenFirst("b")}
                >
                  Первым поймал {opponentPerson}
                </button>
              </div>
            )}
            {decision.decidedBy === "goldenFish" && winnerName && (
              <p className="mt-2 text-sm font-semibold text-yellow-50">Дальше проходит {winnerName}: победа по золотой рыбе.</p>
            )}
          </div>
        </Reveal>

        <Reveal open={showRanking}>
          <p className="rounded-2xl bg-rose-400/15 px-3 py-2 text-sm font-semibold text-rose-50">
            Внимание! Победитель будет определен по итогам группы. Проходит {rankingName}
          </p>
        </Reveal>

        <button
          type="button"
          className="mt-3 h-14 w-full rounded-2xl bg-amber-400 text-base font-black tracking-wide text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
          disabled={saving || confirmed || needsFirst || (regulationTied && !regulationReady)}
          onClick={() => void confirmAndToast(() => confirmPeriod(organizer))}
        >
          {saving ? "Сохраняем..." : confirmed ? "Дуэль сохранена" : "Подтвердить поимки"}
        </button>
        {visibleError && <p className="mt-2 text-center text-sm text-rose-300">{visibleError}</p>}
      </section>
    </div>
  );
}

function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
        open ? "mt-3 grid-rows-[1fr] opacity-100" : "pointer-events-none mt-0 grid-rows-[0fr] opacity-0"
      }`}
      aria-hidden={open ? undefined : true}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function BracketHalf({
  left,
  right,
  nameOf,
  activeMatchId,
  openMatch,
}: {
  left: readonly [PlayoffBracketMatch, PlayoffBracketMatch];
  right: PlayoffBracketMatch;
  nameOf: (slotId: string | null, stage: PlayoffStage) => string;
  activeMatchId: string;
  openMatch: (match: PlayoffBracketMatch) => (() => void) | undefined;
}) {
  return (
    <div className="flex items-center">
      <div className="flex w-80 shrink-0 flex-col gap-4">
        <MatchCard match={left[0]} nameOf={nameOf} active={activeMatchId === left[0].matchId} onOpen={openMatch(left[0])} />
        <MatchCard match={left[1]} nameOf={nameOf} active={activeMatchId === left[1].matchId} onOpen={openMatch(left[1])} />
      </div>
      <BracketJoin />
      <div className="w-80 shrink-0">
        <MatchCard match={right} nameOf={nameOf} active={activeMatchId === right.matchId} onOpen={openMatch(right)} />
      </div>
    </div>
  );
}

function BracketJoin() {
  return (
    <div className="relative mx-1.5 w-16 shrink-0 self-stretch" aria-hidden="true">
      <div className="absolute top-[14%] bottom-[14%] left-0 w-9 rounded-r-[1.6rem] border-y-[3px] border-r-[3px] border-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.45)]" />
      <div className="absolute top-1/2 left-9 h-[3px] w-7 -translate-y-1/2 bg-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.7)]" />
    </div>
  );
}

function MatchCard({
  match,
  nameOf,
  featured = false,
  bronze = false,
  active = false,
  onOpen,
}: {
  match: PlayoffBracketMatch;
  nameOf: (slotId: string | null, stage: PlayoffStage) => string;
  featured?: boolean;
  bronze?: boolean;
  active?: boolean;
  onOpen?: () => void;
}) {
  const marker = overtimeMarker(match.decidedBy);
  const className = `w-full overflow-hidden rounded-2xl border bg-slate-900 text-left ${
    active
      ? "border-cyan-300 ring-2 ring-cyan-300"
      : featured
        ? "border-amber-300 shadow-xl shadow-amber-400/20"
        : bronze
          ? "border-amber-700/50"
          : "border-white/10"
  } ${onOpen ? "cursor-pointer hover:border-cyan-200/50" : ""}`;
  const body = (
    <>
      <p className="bg-slate-950 px-4 py-2.5 text-[11px] font-bold tracking-[0.16em] text-slate-300 uppercase">
        {playoffStageTitle(match.stage)}
        {match.seedA !== null && match.seedB !== null ? ` · ${match.seedA}—${match.seedB}` : ""}
      </p>
      <MatchSide
        name={nameOf(match.slotIdA, match.stage)}
        place={match.placeA}
        fish={match.fishA}
        winner={match.winnerSlotId !== null && match.winnerSlotId === match.slotIdA}
        waiting={match.slotIdA === null}
      />
      <MatchSide
        name={nameOf(match.slotIdB, match.stage)}
        place={match.placeB}
        fish={match.fishB}
        winner={match.winnerSlotId !== null && match.winnerSlotId === match.slotIdB}
        waiting={match.slotIdB === null}
        divider
      />
      {marker && (
        <p
          className={`border-t px-3 py-1.5 text-[11px] font-semibold ${
            match.decidedBy === "goldenFish"
              ? "border-yellow-200/30 bg-yellow-200/10 text-yellow-50"
              : match.decidedBy === "extraTime"
                ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                : "border-amber-300/20 bg-amber-300/10 text-amber-100"
          }`}
        >
          {marker}
        </p>
      )}
    </>
  );

  if (!onOpen) {
    return (
      <article className={className} data-match-id={match.matchId}>
        {body}
      </article>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-match-id={match.matchId}
      aria-label={`Ввести поимки, ${playoffStageTitle(match.stage)}: ${nameOf(match.slotIdA, match.stage)} — ${nameOf(match.slotIdB, match.stage)}`}
      aria-pressed={active}
      onClick={onOpen}
    >
      {body}
    </button>
  );
}

function MatchSide({
  name,
  place,
  fish,
  winner,
  waiting,
  divider = false,
}: {
  name: string;
  place: number | null;
  fish: number | null;
  winner: boolean;
  waiting: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 ${divider ? "border-t border-white/10" : ""} ${
        winner ? "bg-cyan-300/15 text-cyan-50" : "text-slate-100"
      }`}
      data-advanced={winner ? "true" : "false"}
    >
      <span className={`line-clamp-2 min-w-0 text-base font-bold leading-snug ${waiting ? "text-slate-500" : ""}`}>{name}</span>
      <span className="flex shrink-0 items-center gap-2">
        {place !== null && <span className="text-[11px] font-bold text-slate-400">#{place}</span>}
        <span className="w-8 text-right text-xl font-black tabular-nums">{fish === null ? "–" : fish}</span>
      </span>
    </div>
  );
}

function CatchRow({
  slotId,
  bibNumber,
  displayName,
  place,
  count,
  disabled,
  canRename,
  onPlus,
  onMinus,
}: {
  slotId: string;
  bibNumber: number;
  displayName: string;
  place: number;
  count: number;
  disabled: boolean;
  canRename: boolean;
  onPlus: () => void;
  onMinus: () => void;
}) {
  const replaceParticipant = useMatchStore((state) => state.replaceParticipant);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const title = `${bibNumber}. ${displayName}`;

  function beginEdit() {
    setDraft(displayName);
    setEditing(true);
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name || busy) return;
    if (name === displayName) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const ok = await replaceParticipant(slotId, name);
    setBusy(false);
    if (!ok) {
      toast("err", useMatchStore.getState().setupError ?? "Не удалось записать ФИО");
      return;
    }
    setEditing(false);
    toast("ok", "ФИО сохранено");
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form className="flex items-center gap-1" onSubmit={(event) => void saveName(event)}>
            <span className="shrink-0 text-sm font-black tabular-nums text-cyan-100">{bibNumber}.</span>
            <input
              className="h-9 min-w-0 flex-1 rounded-lg border border-cyan-300/50 bg-slate-900 px-2 text-sm font-semibold text-white outline-none"
              value={draft}
              aria-label={`ФИО, номер ${bibNumber}`}
              autoFocus
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                }
              }}
            />
            <button
              type="submit"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-300 text-slate-950 disabled:opacity-40"
              aria-label={`Сохранить ФИО, номер ${bibNumber}`}
              disabled={busy || draft.trim().length === 0}
            >
              <CheckIcon />
            </button>
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <p className="truncate text-sm font-bold">{title}</p>
            {canRename && (
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-cyan-200 hover:bg-white/10 disabled:opacity-40"
                aria-label={`Исправить ФИО, ${title}`}
                disabled={disabled}
                onClick={beginEdit}
              >
                <PencilIcon />
              </button>
            )}
          </div>
        )}
        <p className="text-[11px] font-semibold text-slate-400">Место отбора {place}</p>
      </div>
      <button
        type="button"
        className="h-11 w-11 rounded-xl bg-rose-500 text-lg font-black text-white disabled:opacity-40"
        disabled={disabled || editing || count === 0}
        onClick={onMinus}
        aria-label={`Минус, ${title}`}
      >
        −
      </button>
      <p className="w-8 text-center text-2xl font-black tabular-nums">{count}</p>
      <button
        type="button"
        className="h-11 w-11 rounded-xl bg-emerald-400 text-lg font-black text-slate-950 disabled:opacity-40"
        disabled={disabled || editing}
        onClick={onPlus}
        aria-label={`Плюс, ${title}`}
      >
        +
      </button>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5 10 17l9-10" />
    </svg>
  );
}
