import {
  ALL_MOVEMENTS,
  OPPOSITE,
  parseMovement,
  type Movement,
  type Phase,
} from './types';

/**
 * Two movements are *compatible* if they may show green at the same time
 * without creating a vehicle path conflict. The model is intentionally
 * conservative — protected lefts only, no permissive crossings.
 *
 * Rules:
 *   - Same approach: always compatible (lanes from one approach do not
 *     cross each other inside the intersection).
 *   - Opposite approaches:
 *       STRAIGHT + STRAIGHT  → compatible (parallel paths)
 *       LEFT     + LEFT      → compatible (protected-left phase)
 *       RIGHT    + anything  → compatible (parallel exit lanes)
 *       LEFT     + STRAIGHT  → CONFLICT (left crosses opposing through)
 *   - Perpendicular approaches: always CONFLICT.
 *
 * RIGHT turns are kept conservative (treated as compatible only with
 * the opposite approach, not perpendicular). Real intersections often
 * permit right-on-red with yield, but modeling that as "always green"
 * would mask conflicts in the property test. We model right-on-red
 * separately as a yield behavior, not as a phase-level green.
 */
export function compatible(a: Movement, b: Movement): boolean {
  if (a === b) return true;

  const { approach: aA, kind: aK } = parseMovement(a);
  const { approach: bA, kind: bK } = parseMovement(b);

  if (aA === bA) return true;

  const isOpposite = OPPOSITE[aA] === bA;
  if (!isOpposite) return false;

  if (aK === 'STRAIGHT' && bK === 'STRAIGHT') return true;
  if (aK === 'LEFT' && bK === 'LEFT') return true;
  if (aK === 'RIGHT' || bK === 'RIGHT') return true;

  return false;
}

export type ConflictMatrix = ReadonlyMap<Movement, ReadonlySet<Movement>>;

export function buildConflictMatrix(): ConflictMatrix {
  const m = new Map<Movement, Set<Movement>>();
  for (const a of ALL_MOVEMENTS) {
    const conflicts = new Set<Movement>();
    for (const b of ALL_MOVEMENTS) {
      if (a !== b && !compatible(a, b)) conflicts.add(b);
    }
    m.set(a, conflicts);
  }
  return m;
}

export function isPhaseSafe(phase: Phase): { ok: true } | { ok: false; conflict: [Movement, Movement] } {
  const moves = [...phase.movements];
  for (let i = 0; i < moves.length; i++) {
    for (let j = i + 1; j < moves.length; j++) {
      const a = moves[i]!;
      const b = moves[j]!;
      if (!compatible(a, b)) return { ok: false, conflict: [a, b] };
    }
  }
  return { ok: true };
}

export function assertPhaseSafe(phase: Phase): void {
  const r = isPhaseSafe(phase);
  if (!r.ok) {
    throw new Error(
      `Unsafe phase "${phase.id}": ${r.conflict[0]} conflicts with ${r.conflict[1]}`,
    );
  }
}

/** Are all movements in `set` pairwise compatible? */
export function isMovementSetSafe(
  set: Iterable<Movement>,
): { ok: true } | { ok: false; conflict: [Movement, Movement] } {
  const moves = [...set];
  for (let i = 0; i < moves.length; i++) {
    for (let j = i + 1; j < moves.length; j++) {
      const a = moves[i]!;
      const b = moves[j]!;
      if (!compatible(a, b)) return { ok: false, conflict: [a, b] };
    }
  }
  return { ok: true };
}
