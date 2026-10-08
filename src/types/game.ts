export type GameState = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'ROUND_SUMMARY' | 'GAME_OVER';

export type DifficultyLevel = 'INITIATE' | 'STALKER' | 'NIGHTMARE';

export interface Vector2D {
  x: number;
  y: number;
}

export interface TimelineFrame {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  timestamp: number;
}

export type WraithAbilityType = 'SPEED_SURGE' | 'VOID_TELEPORT' | 'SONAR_PING' | 'CHRONO_STALK';

export interface EnemyWraith {
  id: string;
  name: string;
  role: 'SHADOW_CHASER' | 'CORRIDOR_CUTTER' | 'FLANK_HUNTER' | 'ERRATIC_LURKER';
  abilityType: WraithAbilityType;
  abilityName: string;
  abilityDescription: string;
  abilityState: 'COOLDOWN' | 'ACTIVE';
  abilityCooldown: number;
  abilityMaxCooldown: number;
  abilityActiveTimer: number;
  sonarTarget: Vector2D | null;
  sonarPulseRadius: number;
  teleportFlashTimer: number;
  patrolWaypoint: Vector2D;
  color: string;
  glowColor: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  baseSpeed: number;
  currentSpeed: number;
  isTrailingClosely: boolean;
  distanceToPlayer: number;
}

export interface SniperTower {
  id: 'NW' | 'NE' | 'SW' | 'SE';
  label: string;
  gridX: number;
  gridY: number;
  x: number;
  y: number;
  range: number;
  aimAngle: number;
  state: 'SCANNING' | 'LOCKING' | 'FIRING' | 'COOLDOWN';
  lockProgress: number; // 0 to 1
  lockDuration: number; // seconds to lock before firing
  cooldownTimer: number;
}

export interface SniperBullet {
  id: string;
  towerId: 'NW' | 'NE' | 'SW' | 'SE';
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: Vector2D[];
  spawnTime: number;
  dodgedViaRewind: boolean;
}

export interface JumpscareEvent {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  triggerReason: 'CORRIDOR_ANOMaly' | 'SNIPER_PROXIMITY' | 'WRAITH_WHISPER' | 'MANUAL_TEST';
}

export interface DeathReport {
  reason: 'WRAITH_CAUGHT' | 'TEMPORAL_PARADOX_WRAITH' | 'SNIPER_HEADSHOT';
  killerName: string;
  description: string;
  tokensCollected: number;
  totalTokens: number;
  bulletsDodgedByRewind: number;
  jumpscaresSurvived: number;
  finalScore: number;
  sectorReached: number;
}

/**
 * 21x21 symmetrical tactical horror maze.
 * Legend:
 * 1 = Obsidian Wall
 * 0 = Corridor with Golden Chrono-Token
 * 2 = Empty Corridor (Spawn / Ghost House)
 * 3 = Temporal Flux Crystal (Refills Chrono-Rewind energy + bonus score)
 * 4 = Corner Sniper Bastion (Sniper Tower Mount)
 */
export const MAZE_GRID_TEMPLATE: number[][] = [
  [4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4],
  [1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1],
  [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 2, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 2, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
  [1, 3, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 3, 1],
  [4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4],
];

export const GRID_SIZE = 21;
export const TILE_PIXEL_SIZE = 32; // 21 * 32 = 672px square canvas
export const CANVAS_DIMENSION = GRID_SIZE * TILE_PIXEL_SIZE;
