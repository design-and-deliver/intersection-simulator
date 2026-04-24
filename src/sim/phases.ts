import { assertPhaseSafe } from './conflicts';
import type { Movement, Phase } from './types';

const set = (...m: Movement[]): ReadonlySet<Movement> => new Set(m);

export const PHASE_A_NS_THROUGH: Phase = {
  id: 'A',
  label: 'NS through',
  movements: set('N-STRAIGHT', 'N-RIGHT', 'S-STRAIGHT', 'S-RIGHT'),
};

export const PHASE_B_NS_LEFT: Phase = {
  id: 'B',
  label: 'NS protected left',
  movements: set('N-LEFT', 'S-LEFT'),
};

export const PHASE_C_EW_THROUGH: Phase = {
  id: 'C',
  label: 'EW through',
  movements: set('E-STRAIGHT', 'E-RIGHT', 'W-STRAIGHT', 'W-RIGHT'),
};

export const PHASE_D_EW_LEFT: Phase = {
  id: 'D',
  label: 'EW protected left',
  movements: set('E-LEFT', 'W-LEFT'),
};

export const PHASE_P_PED: Phase = {
  id: 'P',
  label: 'Pedestrian',
  movements: set(),
};

/** The standard ring. Pedestrian phase is inserted on demand by the controller. */
export const RING: readonly Phase[] = [
  PHASE_A_NS_THROUGH,
  PHASE_B_NS_LEFT,
  PHASE_C_EW_THROUGH,
  PHASE_D_EW_LEFT,
];

export const ALL_DEFINED_PHASES: readonly Phase[] = [...RING, PHASE_P_PED];

// Validate at module load — refuse to start with an unsafe phase.
for (const p of ALL_DEFINED_PHASES) assertPhaseSafe(p);
