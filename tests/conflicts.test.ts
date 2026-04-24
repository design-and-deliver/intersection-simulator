import { describe, it, expect } from 'vitest';
import {
  ALL_MOVEMENTS,
  parseMovement,
  type Movement,
} from '../src/sim/types';
import {
  buildConflictMatrix,
  compatible,
  isPhaseSafe,
} from '../src/sim/conflicts';
import {
  PHASE_A_NS_THROUGH,
  PHASE_B_NS_LEFT,
  PHASE_C_EW_THROUGH,
  PHASE_D_EW_LEFT,
  ALL_DEFINED_PHASES,
} from '../src/sim/phases';

describe('compatible()', () => {
  it('is reflexive', () => {
    for (const m of ALL_MOVEMENTS) expect(compatible(m, m)).toBe(true);
  });

  it('is symmetric for every pair', () => {
    for (const a of ALL_MOVEMENTS) {
      for (const b of ALL_MOVEMENTS) {
        expect(compatible(a, b)).toBe(compatible(b, a));
      }
    }
  });

  it('treats same-approach movements as compatible', () => {
    const sameApproach: [Movement, Movement][] = [
      ['N-LEFT', 'N-STRAIGHT'],
      ['N-STRAIGHT', 'N-RIGHT'],
      ['N-LEFT', 'N-RIGHT'],
      ['E-LEFT', 'E-STRAIGHT'],
    ];
    for (const [a, b] of sameApproach) expect(compatible(a, b)).toBe(true);
  });

  it('allows opposite straight + straight', () => {
    expect(compatible('N-STRAIGHT', 'S-STRAIGHT')).toBe(true);
    expect(compatible('E-STRAIGHT', 'W-STRAIGHT')).toBe(true);
  });

  it('allows opposite left + left (protected left phase)', () => {
    expect(compatible('N-LEFT', 'S-LEFT')).toBe(true);
    expect(compatible('E-LEFT', 'W-LEFT')).toBe(true);
  });

  it('forbids opposite left + straight (left crosses oncoming through)', () => {
    expect(compatible('N-LEFT', 'S-STRAIGHT')).toBe(false);
    expect(compatible('S-LEFT', 'N-STRAIGHT')).toBe(false);
    expect(compatible('E-LEFT', 'W-STRAIGHT')).toBe(false);
    expect(compatible('W-LEFT', 'E-STRAIGHT')).toBe(false);
  });

  it('forbids any perpendicular pair (no rights-as-permissive)', () => {
    for (const a of ALL_MOVEMENTS) {
      for (const b of ALL_MOVEMENTS) {
        const { approach: aA } = parseMovement(a);
        const { approach: bA } = parseMovement(b);
        const perpendicular =
          (['N', 'S'].includes(aA) && ['E', 'W'].includes(bA)) ||
          (['E', 'W'].includes(aA) && ['N', 'S'].includes(bA));
        if (perpendicular) {
          expect(compatible(a, b)).toBe(false);
        }
      }
    }
  });
});

describe('buildConflictMatrix()', () => {
  it('contains every movement as a key', () => {
    const m = buildConflictMatrix();
    for (const mv of ALL_MOVEMENTS) expect(m.has(mv)).toBe(true);
  });

  it('is symmetric (a conflicts with b ⇔ b conflicts with a)', () => {
    const m = buildConflictMatrix();
    for (const a of ALL_MOVEMENTS) {
      for (const b of m.get(a)!) {
        expect(m.get(b)!.has(a)).toBe(true);
      }
    }
  });

  it('never lists a movement as conflicting with itself', () => {
    const m = buildConflictMatrix();
    for (const a of ALL_MOVEMENTS) expect(m.get(a)!.has(a)).toBe(false);
  });
});

describe('isPhaseSafe() / standard phases', () => {
  it.each(ALL_DEFINED_PHASES)('phase $id ($label) is internally safe', (phase) => {
    expect(isPhaseSafe(phase).ok).toBe(true);
  });

  it('rejects an unsafe phase (NS-LEFT + NS-STRAIGHT crossing test)', () => {
    const bad = {
      id: 'BAD',
      label: 'unsafe',
      movements: new Set<Movement>(['N-LEFT', 'S-STRAIGHT']),
    };
    const r = isPhaseSafe(bad);
    expect(r.ok).toBe(false);
  });
});

describe('phase definitions', () => {
  it('NS-through covers the expected movements', () => {
    expect([...PHASE_A_NS_THROUGH.movements].sort()).toEqual(
      ['N-RIGHT', 'N-STRAIGHT', 'S-RIGHT', 'S-STRAIGHT'].sort(),
    );
  });

  it('NS-protected-left contains only the two opposing lefts', () => {
    expect([...PHASE_B_NS_LEFT.movements].sort()).toEqual(['N-LEFT', 'S-LEFT'].sort());
  });

  it('EW phases mirror NS phases', () => {
    expect(PHASE_C_EW_THROUGH.movements.size).toBe(PHASE_A_NS_THROUGH.movements.size);
    expect(PHASE_D_EW_LEFT.movements.size).toBe(PHASE_B_NS_LEFT.movements.size);
  });
});
