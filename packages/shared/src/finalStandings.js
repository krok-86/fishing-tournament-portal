"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFinalStandings = buildFinalStandings;
/**
 * Итог турнира: 1 чемпион, 2 финалист, 3 и 4 — матч за бронзу,
 * 5–8 — проигравшие четвертьфинала по месту отбора, дальше групповой этап.
 * Пока нет победителей финала и матча за 3-е место, таблицы нет.
 */
function buildFinalStandings(input) {
    const final = input.playoff.final;
    const third = input.playoff.thirdPlace;
    if (!final || !third)
        return null;
    const championId = final.winnerSlotId;
    const finalistId = otherSlot(final);
    const thirdId = third.winnerSlotId;
    const fourthId = otherSlot(third);
    if (!championId || !finalistId || !thirdId || !fourthId)
        return null;
    const medal = new Set([championId, finalistId, thirdId, fourthId]);
    const quarterLosers = [];
    for (const match of input.playoff.quarterfinals) {
        const loserId = otherSlot(match);
        if (!loserId || medal.has(loserId) || quarterLosers.includes(loserId))
            continue;
        quarterLosers.push(loserId);
    }
    quarterLosers.sort((left, right) => compareQualifying(left, right, input));
    const placed = new Set([...medal, ...quarterLosers]);
    const groupIds = input.leaderboard
        .filter((entry) => !placed.has(entry.slotId))
        .map((entry) => entry.slotId);
    for (const id of groupIds)
        placed.add(id);
    const rest = input.participants
        .filter((person) => !placed.has(person.slotId))
        .sort((left, right) => left.bibNumber - right.bibNumber)
        .map((person) => person.slotId);
    const ordered = [
        { slotId: championId, stage: "Чемпион" },
        { slotId: finalistId, stage: "Финалист" },
        { slotId: thirdId, stage: "3-е место" },
        { slotId: fourthId, stage: "4-е место" },
        ...quarterLosers.map((slotId) => ({ slotId, stage: "1/4 финала" })),
        ...groupIds.map((slotId) => ({ slotId, stage: "Групповой этап" })),
        ...rest.map((slotId) => ({ slotId, stage: "Групповой этап" })),
    ];
    return ordered.map((row, index) => {
        const person = describe(row.slotId, input);
        return {
            place: index + 1,
            slotId: row.slotId,
            bibNumber: person.bibNumber,
            displayName: person.displayName,
            qualifyingFish: person.qualifyingFish,
            stage: row.stage,
        };
    });
}
function otherSlot(match) {
    if (!match.winnerSlotId || !match.slotIdA || !match.slotIdB)
        return null;
    if (match.winnerSlotId === match.slotIdA)
        return match.slotIdB;
    if (match.winnerSlotId === match.slotIdB)
        return match.slotIdA;
    return null;
}
function describe(slotId, input) {
    const row = input.leaderboard.find((entry) => entry.slotId === slotId);
    const person = input.participants.find((item) => item.slotId === slotId);
    return {
        bibNumber: row?.bibNumber ?? person?.bibNumber ?? 0,
        displayName: row?.displayName ?? person?.displayName ?? "—",
        qualifyingFish: row?.fishCount ?? 0,
        qualifyingPlace: row?.place ?? Number.MAX_SAFE_INTEGER,
    };
}
function compareQualifying(leftId, rightId, input) {
    const left = describe(leftId, input);
    const right = describe(rightId, input);
    return left.qualifyingPlace - right.qualifyingPlace || left.bibNumber - right.bibNumber;
}
