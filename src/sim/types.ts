export const APPROACHES = ['N', 'S', 'E', 'W'] as const;
export type Approach = (typeof APPROACHES)[number];

export const LANE_KINDS = ['LEFT', 'STRAIGHT', 'RIGHT'] as const;
export type LaneKind = (typeof LANE_KINDS)[number];

export type Movement = `${Approach}-${LaneKind}`;

export const ALL_MOVEMENTS: readonly Movement[] = APPROACHES.flatMap((a) =>
  LANE_KINDS.map((k) => `${a}-${k}` as Movement),
);

export const OPPOSITE: Record<Approach, Approach> = {
  N: 'S',
  S: 'N',
  E: 'W',
  W: 'E',
};

export function parseMovement(m: Movement): { approach: Approach; kind: LaneKind } {
  const [approach, kind] = m.split('-') as [Approach, LaneKind];
  return { approach, kind };
}

export type SignalColor = 'RED' | 'YELLOW' | 'GREEN';
export type LeftSignalColor = SignalColor | 'FLASHING_ORANGE';

export type WalkSignal = 'WALK' | 'FLASH_DONT_WALK' | 'DONT_WALK';

export interface Phase {
  readonly id: string;
  readonly label: string;
  readonly movements: ReadonlySet<Movement>;
}
