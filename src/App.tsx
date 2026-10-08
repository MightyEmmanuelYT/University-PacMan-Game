import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CANVAS_DIMENSION,
  DeathReport,
  DifficultyLevel,
  EnemyWraith,
  GameState,
  GRID_SIZE,
  JumpscareEvent,
  MAZE_GRID_TEMPLATE,
  SniperBullet,
  SniperTower,
  TILE_PIXEL_SIZE,
  TimelineFrame,
  Vector2D,
} from './types/game';
import { soundEngine } from './utils/soundEngine';
import { JumpscareOverlay } from './components/JumpscareOverlay';
import { HowToPlayModal } from './components/HowToPlayModal';
import {
  Volume2,
  VolumeX,
  RotateCcw,
  Play,
  Pause,
  History,
  Crosshair,
  Skull,
  ShieldAlert,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Zap,
  Trophy,
  Ghost,
} from 'lucide-react';

// Import generated high-fidelity horror and hero assets
import jumpscarePhantomImg from './assets/images/jumpscare_phantom_entity_1791471684740.jpg';
import jumpscareClockworkImg from './assets/images/jumpscare_clockwork_fiend_1791471696142.jpg';
import chronoMazeHeroImg from './assets/images/chrono_maze_hero_art_1791471707270.jpg';

const JUMPSCARE_CATALOG: Omit<JumpscareEvent, 'id' | 'triggerReason'>[] = [
  {
    title: 'THE WEEPING ARCHIVIST SEES YOU',
    subtitle: 'Your timeline leaves a scent in the dark.',
    imageUrl: jumpscarePhantomImg,
  },
  {
    title: 'CLOCKWORK HARVESTER OVERRIDE',
    subtitle: 'Corner turret optics have locked onto your pulse.',
    imageUrl: jumpscareClockworkImg,
  },
];

const MAX_TIMELINE_FRAMES = 220; // ~3.6 seconds of rewind history at 60fps
const REWIND_DRAIN_PER_FRAME = 0.65;
const REWIND_RECHARGE_PER_FRAME = 0.16;

function tileCenter(gridCoord: number): number {
  return gridCoord * TILE_PIXEL_SIZE + TILE_PIXEL_SIZE / 2;
}

function pixelToGrid(px: number): number {
  return Math.floor(px / TILE_PIXEL_SIZE);
}

function isWallTile(grid: number[][], gx: number, gy: number): boolean {
  if (gy < 0 || gy >= GRID_SIZE || gx < 0 || gx >= GRID_SIZE) return true;
  const cell = grid[gy][gx];
  return cell === 1 || cell === 4;
}

/**
 * Computes the next cardinal grid step from (startGx, startGy) toward (targetGx, targetGy)
 * using Breadth-First Search (BFS) across the entire maze so Wraiths never get stuck in rooms
 * or behind walls, and patrol the whole labyrinth seamlessly.
 */
function getNextStepBFS(
  grid: number[][],
  startGx: number,
  startGy: number,
  targetGx: number,
  targetGy: number,
  forbidDirX: number,
  forbidDirY: number
): Vector2D {
  const dirs: Vector2D[] = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];

  const validFirstDirs = dirs.filter((d) => {
    if (d.x === forbidDirX && d.y === forbidDirY) return false;
    return !isWallTile(grid, startGx + d.x, startGy + d.y);
  });

  // Fallback if dead-end requires reversing
  if (validFirstDirs.length === 0) {
    const rev = { x: forbidDirX, y: forbidDirY };
    if (!isWallTile(grid, startGx + rev.x, startGy + rev.y)) {
      return rev;
    }
    return { x: 0, y: 0 };
  }

  if (validFirstDirs.length === 1) {
    return validFirstDirs[0];
  }

  // BFS queue stores { gx, gy, firstDir }
  const visited = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill(false)
  );
  visited[startGy][startGx] = true;

  const queue: { gx: number; gy: number; firstDir: Vector2D }[] = [];
  for (const d of validFirstDirs) {
    const nx = startGx + d.x;
    const ny = startGy + d.y;
    if (nx === targetGx && ny === targetGy) {
      return d;
    }
    visited[ny][nx] = true;
    queue.push({ gx: nx, gy: ny, firstDir: d });
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const d of dirs) {
      const nx = curr.gx + d.x;
      const ny = curr.gy + d.y;
      if (!isWallTile(grid, nx, ny) && !visited[ny][nx]) {
        if (nx === targetGx && ny === targetGy) {
          return curr.firstDir;
        }
        visited[ny][nx] = true;
        queue.push({ gx: nx, gy: ny, firstDir: curr.firstDir });
      }
    }
  }

  // If target tile was a wall or unreachable, pick the valid first step closest by Euclidean distance
  let best = validFirstDirs[0];
  let bestDist = Infinity;
  for (const d of validFirstDirs) {
    const dist = Math.hypot(
      startGx + d.x - targetGx,
      startGy + d.y - targetGy
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

function getRandomWalkableTile(
  grid: number[][],
  avoidGx?: number,
  avoidGy?: number,
  minTileDist = 4
): { gx: number; gy: number; x: number; y: number } {
  const candidates: { gx: number; gy: number }[] = [];
  for (let r = 1; r < GRID_SIZE - 1; r++) {
    for (let c = 1; c < GRID_SIZE - 1; c++) {
      if (!isWallTile(grid, c, r)) {
        if (avoidGx !== undefined && avoidGy !== undefined) {
          const d = Math.hypot(c - avoidGx, r - avoidGy);
          if (d < minTileDist) continue;
        }
        candidates.push({ gx: c, gy: r });
      }
    }
  }
  const pick =
    candidates[Math.floor(Math.random() * candidates.length)] || {
      gx: 10,
      gy: 4,
    };
  return {
    gx: pick.gx,
    gy: pick.gy,
    x: tileCenter(pick.gx),
    y: tileCenter(pick.gy),
  };
}

export default function App() {
  // Game State Machine
  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('STALKER');
  const [muted, setMuted] = useState<boolean>(false);
  const [reducedTerror, setReducedTerror] = useState<boolean>(false);

  // HUD Reactive State
  const [score, setScore] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(0);
  const [sector, setSector] = useState<number>(1);
  const [tokensRemaining, setTokensRemaining] = useState<number>(0);
  const [totalTokensInSector, setTotalTokensInSector] = useState<number>(0);
  const [chronoCharge, setChronoCharge] = useState<number>(100);
  const [isRewindingUI, setIsRewindingUI] = useState<boolean>(false);
  const [paradoxRiskStatus, setParadoxRiskStatus] = useState<
    'SAFE' | 'CAUTION' | 'CRITICAL'
  >('SAFE');
  const [closestWraithDist, setClosestWraithDist] = useState<number>(99);
  const [bulletsDodged, setBulletsDodged] = useState<number>(0);
  const [jumpscaresSurvived, setJumpscaresSurvived] = useState<number>(0);
  const [activeJumpscare, setActiveJumpscare] = useState<JumpscareEvent | null>(
    null
  );
  const [deathReport, setDeathReport] = useState<DeathReport | null>(null);
  const [towerTelemetry, setTowerTelemetry] = useState<
    { id: string; label: string; state: SniperTower['state']; lockPct: number }[]
  >([]);
  const [wraithTelemetry, setWraithTelemetry] = useState<
    {
      id: string;
      name: string;
      abilityName: string;
      abilityState: 'COOLDOWN' | 'ACTIVE';
      cooldownSec: number;
      color: string;
    }[]
  >([]);
  const [combatLog, setCombatLog] = useState<string>(
    'Collect all golden Chrono-Tokens. Hold SPACE to rewind time when a corner sniper fires.'
  );

  // Mutable Engine Refs for 60fps Canvas Loop
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mazeGridRef = useRef<number[][]>([]);
  const playerRef = useRef<{
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    nextDirX: number;
    nextDirY: number;
    speed: number;
    mouthAngle: number;
    mouthOpening: boolean;
  }>({
    x: tileCenter(10),
    y: tileCenter(16),
    dirX: 0,
    dirY: 0,
    nextDirX: 0,
    nextDirY: 0,
    speed: 2.35,
    mouthAngle: 0.2,
    mouthOpening: true,
  });

  const timelineRef = useRef<TimelineFrame[]>([]);
  const isRewindingRef = useRef<boolean>(false);
  const chronoChargeRef = useRef<number>(100);
  const wraithsRef = useRef<EnemyWraith[]>([]);
  const towersRef = useRef<SniperTower[]>([]);
  const bulletsRef = useRef<SniperBullet[]>([]);
  const scoreRef = useRef<number>(0);
  const tokensLeftRef = useRef<number>(0);
  const totalTokensRef = useRef<number>(0);
  const bulletsDodgedRef = useRef<number>(0);
  const jumpscaresCountRef = useRef<number>(0);
  const lastJumpscareTimeRef = useRef<number>(0);
  const jumpscareTimeoutRef = useRef<number | null>(null);
  const frameCountRef = useRef<number>(0);

  // Sync mute state with SoundEngine
  useEffect(() => {
    soundEngine.muted = muted;
  }, [muted]);

  // Trigger a psychological jumpscare overlay without breaking keyboard control
  const triggerJumpscare = useCallback(
    (reason: JumpscareEvent['triggerReason']) => {
      const now = performance.now();
      if (reason !== 'MANUAL_TEST' && now - lastJumpscareTimeRef.current < 15000) {
        return;
      }
      lastJumpscareTimeRef.current = now;
      jumpscaresCountRef.current += 1;
      setJumpscaresSurvived(jumpscaresCountRef.current);

      const template =
        JUMPSCARE_CATALOG[Math.floor(Math.random() * JUMPSCARE_CATALOG.length)];
      const scareEvent: JumpscareEvent = {
        ...template,
        id: `${now}-${Math.random()}`,
        triggerReason: reason,
      };

      soundEngine.playJumpscareStinger();
      setActiveJumpscare(scareEvent);

      if (jumpscareTimeoutRef.current) {
        window.clearTimeout(jumpscareTimeoutRef.current);
      }
      jumpscareTimeoutRef.current = window.setTimeout(() => {
        setActiveJumpscare(null);
      }, 620);
    },
    []
  );

  // Initialize or Reset Maze & Entities for a Sector
  const initSector = useCallback(
    (targetSector: number, preserveScore: boolean) => {
      const clonedGrid = MAZE_GRID_TEMPLATE.map((row) => [...row]);
      let tokenCount = 0;
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          if (clonedGrid[r][c] === 0 || clonedGrid[r][c] === 3) {
            tokenCount++;
          }
        }
      }

      mazeGridRef.current = clonedGrid;
      tokensLeftRef.current = tokenCount;
      totalTokensRef.current = tokenCount;
      setTokensRemaining(tokenCount);
      setTotalTokensInSector(tokenCount);

      if (!preserveScore) {
        scoreRef.current = 0;
        setScore(0);
        bulletsDodgedRef.current = 0;
        setBulletsDodged(0);
        jumpscaresCountRef.current = 0;
        setJumpscaresSurvived(0);
      }

      // Reset Player at bottom-center spawn tile (10, 16)
      playerRef.current = {
        x: tileCenter(10),
        y: tileCenter(16),
        dirX: 0,
        dirY: 0,
        nextDirX: 0,
        nextDirY: 0,
        speed: 2.4,
        mouthAngle: 0.25,
        mouthOpening: true,
      };

      timelineRef.current = [
        {
          x: tileCenter(10),
          y: tileCenter(16),
          dirX: 0,
          dirY: 0,
          timestamp: performance.now(),
        },
      ];
      chronoChargeRef.current = 100;
      setChronoCharge(100);
      isRewindingRef.current = false;
      setIsRewindingUI(false);
      bulletsRef.current = [];

      // Difficulty multipliers
      const speedMult =
        difficulty === 'INITIATE' ? 0.86 : difficulty === 'STALKER' ? 1.0 : 1.14;
      const sectorBonus = 1 + (targetSector - 1) * 0.06;
      const lockTime =
        difficulty === 'INITIATE' ? 1.55 : difficulty === 'STALKER' ? 1.15 : 0.85;

      // Initialize 4 Patrolling Wraiths across open corridors with distinct unique abilities
      wraithsRef.current = [
        {
          id: 'wraith-crimson',
          name: 'Vespera',
          role: 'SHADOW_CHASER',
          abilityType: 'SPEED_SURGE',
          abilityName: 'Bloodlust Sprint',
          abilityDescription:
            'Periodically surges to 1.65x movement speed while hunting across corridors.',
          abilityState: 'COOLDOWN',
          abilityCooldown: 5.0,
          abilityMaxCooldown: 9.0,
          abilityActiveTimer: 0,
          sonarTarget: null,
          sonarPulseRadius: 0,
          teleportFlashTimer: 0,
          patrolWaypoint: { x: tileCenter(3), y: tileCenter(4) },
          color: '#EF4444',
          glowColor: 'rgba(239, 68, 68, 0.45)',
          x: tileCenter(5),
          y: tileCenter(4),
          dirX: 1,
          dirY: 0,
          baseSpeed: 1.68 * speedMult * sectorBonus,
          currentSpeed: 1.68 * speedMult * sectorBonus,
          isTrailingClosely: false,
          distanceToPlayer: 99,
        },
        {
          id: 'wraith-violet',
          name: 'Morrow',
          role: 'CORRIDOR_CUTTER',
          abilityType: 'VOID_TELEPORT',
          abilityName: 'Phase Blink',
          abilityDescription:
            'Randomly teleports across the labyrinth to a new open corridor.',
          abilityState: 'COOLDOWN',
          abilityCooldown: 7.5,
          abilityMaxCooldown: 11.5,
          abilityActiveTimer: 0,
          sonarTarget: null,
          sonarPulseRadius: 0,
          teleportFlashTimer: 0,
          patrolWaypoint: { x: tileCenter(17), y: tileCenter(4) },
          color: '#A855F7',
          glowColor: 'rgba(168, 85, 247, 0.45)',
          x: tileCenter(15),
          y: tileCenter(4),
          dirX: -1,
          dirY: 0,
          baseSpeed: 1.62 * speedMult * sectorBonus,
          currentSpeed: 1.62 * speedMult * sectorBonus,
          isTrailingClosely: false,
          distanceToPlayer: 99,
        },
        {
          id: 'wraith-emerald',
          name: 'Blight',
          role: 'FLANK_HUNTER',
          abilityType: 'SONAR_PING',
          abilityName: 'Echo Sonar Scan',
          abilityDescription:
            'Emits a private sonar wave that locks onto your exact position at that moment for Blight alone.',
          abilityState: 'COOLDOWN',
          abilityCooldown: 4.0,
          abilityMaxCooldown: 10.0,
          abilityActiveTimer: 0,
          sonarTarget: null,
          sonarPulseRadius: 0,
          teleportFlashTimer: 0,
          patrolWaypoint: { x: tileCenter(3), y: tileCenter(14) },
          color: '#10B981',
          glowColor: 'rgba(16, 185, 129, 0.45)',
          x: tileCenter(5),
          y: tileCenter(10),
          dirX: 0,
          dirY: -1,
          baseSpeed: 1.6 * speedMult * sectorBonus,
          currentSpeed: 1.6 * speedMult * sectorBonus,
          isTrailingClosely: false,
          distanceToPlayer: 99,
        },
        {
          id: 'wraith-amber',
          name: 'Dredge',
          role: 'ERRATIC_LURKER',
          abilityType: 'CHRONO_STALK',
          abilityName: 'Timeline Lock',
          abilityDescription:
            'Surges onto your recorded rewind trail to punish careless time-rewinds.',
          abilityState: 'COOLDOWN',
          abilityCooldown: 6.5,
          abilityMaxCooldown: 10.5,
          abilityActiveTimer: 0,
          sonarTarget: null,
          sonarPulseRadius: 0,
          teleportFlashTimer: 0,
          patrolWaypoint: { x: tileCenter(17), y: tileCenter(14) },
          color: '#F97316',
          glowColor: 'rgba(249, 115, 22, 0.45)',
          x: tileCenter(15),
          y: tileCenter(10),
          dirX: 0,
          dirY: 1,
          baseSpeed: 1.56 * speedMult * sectorBonus,
          currentSpeed: 1.56 * speedMult * sectorBonus,
          isTrailingClosely: false,
          distanceToPlayer: 99,
        },
      ];

      // Initialize 4 Corner Sniper Towers
      const sniperRange = TILE_PIXEL_SIZE * 8.75;
      towersRef.current = [
        {
          id: 'NW',
          label: 'NW Bastion',
          gridX: 0,
          gridY: 0,
          x: tileCenter(0),
          y: tileCenter(0),
          range: sniperRange,
          aimAngle: Math.PI / 4,
          state: 'SCANNING',
          lockProgress: 0,
          lockDuration: lockTime,
          cooldownTimer: 0,
        },
        {
          id: 'NE',
          label: 'NE Bastion',
          gridX: GRID_SIZE - 1,
          gridY: 0,
          x: tileCenter(GRID_SIZE - 1),
          y: tileCenter(0),
          range: sniperRange,
          aimAngle: (3 * Math.PI) / 4,
          state: 'SCANNING',
          lockProgress: 0,
          lockDuration: lockTime,
          cooldownTimer: 0,
        },
        {
          id: 'SW',
          label: 'SW Bastion',
          gridX: 0,
          gridY: GRID_SIZE - 1,
          x: tileCenter(0),
          y: tileCenter(GRID_SIZE - 1),
          range: sniperRange,
          aimAngle: -Math.PI / 4,
          state: 'SCANNING',
          lockProgress: 0,
          lockDuration: lockTime,
          cooldownTimer: 0,
        },
        {
          id: 'SE',
          label: 'SE Bastion',
          gridX: GRID_SIZE - 1,
          gridY: GRID_SIZE - 1,
          x: tileCenter(GRID_SIZE - 1),
          y: tileCenter(GRID_SIZE - 1),
          range: sniperRange,
          aimAngle: (-3 * Math.PI) / 4,
          state: 'SCANNING',
          lockProgress: 0,
          lockDuration: lockTime,
          cooldownTimer: 0,
        },
      ];

      lastJumpscareTimeRef.current = performance.now();
      setDeathReport(null);
      setCombatLog(
        `Sector 0${targetSector} active. Wraiths are patrolling all corridors with unique abilities!`
      );
    },
    [difficulty]
  );

  const handleStartNewGame = useCallback(() => {
    setSector(1);
    initSector(1, false);
    setGameState('PLAYING');
  }, [initSector]);

  const handleNextSector = useCallback(() => {
    const nextSec = sector + 1;
    setSector(nextSec);
    initSector(nextSec, true);
    setGameState('PLAYING');
  }, [sector, initSector]);

  // Keyboard listeners for movement, time rewind, and pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'PLAYING' && gameState !== 'PAUSED') return;

      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault();
        setGameState((prev) => (prev === 'PLAYING' ? 'PAUSED' : 'PLAYING'));
        return;
      }

      if (gameState !== 'PLAYING') return;

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          playerRef.current.nextDirX = 0;
          playerRef.current.nextDirY = -1;
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          playerRef.current.nextDirX = 0;
          playerRef.current.nextDirY = 1;
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          playerRef.current.nextDirX = -1;
          playerRef.current.nextDirY = 0;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          playerRef.current.nextDirX = 1;
          playerRef.current.nextDirY = 0;
          break;
        case ' ':
        case 'Shift':
          e.preventDefault();
          if (chronoChargeRef.current > 5 && timelineRef.current.length > 2) {
            isRewindingRef.current = true;
            setIsRewindingUI(true);
          }
          break;
        default:
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Shift') {
        e.preventDefault();
        isRewindingRef.current = false;
        setIsRewindingUI(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  // Helper to check if an entity can move in a given direction from current pixel coordinates
  const canMoveInDirection = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    speed: number
  ): boolean => {
    if (dx === 0 && dy === 0) return false;
    const radius = TILE_PIXEL_SIZE * 0.36;
    const nextX = x + dx * speed;
    const nextY = y + dy * speed;

    const minGx = pixelToGrid(nextX - radius);
    const maxGx = pixelToGrid(nextX + radius);
    const minGy = pixelToGrid(nextY - radius);
    const maxGy = pixelToGrid(nextY + radius);

    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (isWallTile(mazeGridRef.current, gx, gy)) {
          return false;
        }
      }
    }
    return true;
  };

  // Main 60FPS Game Loop & Canvas Renderer
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    let animationFrameId: number;
    const dt = 1 / 60;

    const updateAndRender = () => {
      frameCountRef.current += 1;
      const p = playerRef.current;
      const grid = mazeGridRef.current;

      // 1. PLAYER MOVEMENT OR TEMPORAL REWIND
      const activelyRewinding =
        isRewindingRef.current &&
        chronoChargeRef.current > 1 &&
        timelineRef.current.length > 2;

      if (activelyRewinding) {
        const popCount = Math.min(2, timelineRef.current.length - 1);
        let targetFrame = timelineRef.current[timelineRef.current.length - 1];
        for (let i = 0; i < popCount; i++) {
          const popped = timelineRef.current.pop();
          if (popped) targetFrame = popped;
        }

        p.x = targetFrame.x;
        p.y = targetFrame.y;
        p.dirX = targetFrame.dirX;
        p.dirY = targetFrame.dirY;

        chronoChargeRef.current = Math.max(
          0,
          chronoChargeRef.current - REWIND_DRAIN_PER_FRAME
        );

        if (frameCountRef.current % 4 === 0) {
          soundEngine.playRewindTick();
        }

        if (chronoChargeRef.current <= 1 || timelineRef.current.length <= 2) {
          isRewindingRef.current = false;
          setIsRewindingUI(false);
        }
      } else {
        isRewindingRef.current = false;
        chronoChargeRef.current = Math.min(
          100,
          chronoChargeRef.current + REWIND_RECHARGE_PER_FRAME
        );

        const currentGx = pixelToGrid(p.x);
        const currentGy = pixelToGrid(p.y);
        const centerX = tileCenter(currentGx);
        const centerY = tileCenter(currentGy);

        // Authentic Pac-Man Buffered Turn & Corridor Rail Movement:
        // 1. Instant 180-degree reversal along the current corridor is always allowed immediately
        if (
          (p.nextDirX !== 0 || p.nextDirY !== 0) &&
          p.nextDirX === -p.dirX &&
          p.nextDirY === -p.dirY
        ) {
          p.dirX = p.nextDirX;
          p.dirY = p.nextDirY;
        }

        // 2. If currently stationary, start moving in nextDir only if that adjacent tile is NOT a wall
        if (p.dirX === 0 && p.dirY === 0) {
          if (
            (p.nextDirX !== 0 || p.nextDirY !== 0) &&
            !isWallTile(grid, currentGx + p.nextDirX, currentGy + p.nextDirY)
          ) {
            p.dirX = p.nextDirX;
            p.dirY = p.nextDirY;
          }
        }

        // 3. Check if queued perpendicular turn (nextDir) can be executed at the current tile center
        if (
          (p.nextDirX !== 0 || p.nextDirY !== 0) &&
          (p.nextDirX !== p.dirX || p.nextDirY !== p.dirY)
        ) {
          const nextTileOpen = !isWallTile(
            grid,
            currentGx + p.nextDirX,
            currentGy + p.nextDirY
          );
          if (nextTileOpen) {
            const distToCenter = Math.hypot(p.x - centerX, p.y - centerY);
            // Cornering window: snap cleanly onto the new corridor centerline and turn!
            if (distToCenter <= p.speed * 1.35) {
              p.x = centerX;
              p.y = centerY;
              p.dirX = p.nextDirX;
              p.dirY = p.nextDirY;
            }
          }
          // If nextTileOpen is false (there is a wall in the pressed direction),
          // p.dirX/p.dirY remains unchanged so the player continues moving straight forward
          // until an opening appears (or until they press forward again to overwrite nextDir)!
        }

        // 4. Advance along current direction, strictly clamping at tile center if a wall is ahead
        if (p.dirX !== 0 || p.dirY !== 0) {
          const activeGx = pixelToGrid(p.x);
          const activeGy = pixelToGrid(p.y);
          const activeCenterX = tileCenter(activeGx);
          const activeCenterY = tileCenter(activeGy);

          // Lock perpendicular axis strictly to corridor centerline
          if (p.dirX !== 0) p.y = activeCenterY;
          if (p.dirY !== 0) p.x = activeCenterX;

          const wallAhead = isWallTile(
            grid,
            activeGx + p.dirX,
            activeGy + p.dirY
          );

          let nextX = p.x + p.dirX * p.speed;
          let nextY = p.y + p.dirY * p.speed;
          let moved = true;

          if (wallAhead) {
            // Do not allow moving past the center of the current tile toward a wall
            if (p.dirX > 0 && nextX >= activeCenterX) {
              nextX = activeCenterX;
              moved = p.x < activeCenterX;
            } else if (p.dirX < 0 && nextX <= activeCenterX) {
              nextX = activeCenterX;
              moved = p.x > activeCenterX;
            } else if (p.dirY > 0 && nextY >= activeCenterY) {
              nextY = activeCenterY;
              moved = p.y < activeCenterY;
            } else if (p.dirY < 0 && nextY <= activeCenterY) {
              nextY = activeCenterY;
              moved = p.y > activeCenterY;
            }
          }

          p.x = nextX;
          p.y = nextY;

          if (moved) {
            if (p.mouthOpening) {
              p.mouthAngle += 0.025;
              if (p.mouthAngle >= 0.38) p.mouthOpening = false;
            } else {
              p.mouthAngle -= 0.025;
              if (p.mouthAngle <= 0.04) p.mouthOpening = true;
            }
          }
        }

        const lastRecorded = timelineRef.current[timelineRef.current.length - 1];
        if (
          !lastRecorded ||
          Math.hypot(p.x - lastRecorded.x, p.y - lastRecorded.y) > 1.5
        ) {
          timelineRef.current.push({
            x: p.x,
            y: p.y,
            dirX: p.dirX,
            dirY: p.dirY,
            timestamp: performance.now(),
          });
          if (timelineRef.current.length > MAX_TIMELINE_FRAMES) {
            timelineRef.current.shift();
          }
        }
      }

      // 2. COLLECT TOKENS & FLUX CRYSTALS
      const playerGx = pixelToGrid(p.x);
      const playerGy = pixelToGrid(p.y);
      const currentCell = grid[playerGy]?.[playerGx];

      if (currentCell === 0) {
        grid[playerGy][playerGx] = 2;
        scoreRef.current += 25;
        tokensLeftRef.current -= 1;
        soundEngine.playTokenCollect();
        setScore(scoreRef.current);
        setTokensRemaining(tokensLeftRef.current);
      } else if (currentCell === 3) {
        grid[playerGy][playerGx] = 2;
        scoreRef.current += 150;
        tokensLeftRef.current -= 1;
        chronoChargeRef.current = Math.min(100, chronoChargeRef.current + 35);
        soundEngine.playPowerShard();
        setScore(scoreRef.current);
        setTokensRemaining(tokensLeftRef.current);
        setCombatLog(
          'Temporal Flux Crystal harvested! +35% Chrono-Rewind Capacitor restored.'
        );
      }

      // Check Sector Victory
      if (tokensLeftRef.current <= 0) {
        soundEngine.playVictory();
        setHighScore((prev) => Math.max(prev, scoreRef.current));
        setGameState('ROUND_SUMMARY');
        return;
      }

      // 3. UPDATE CORNER SNIPER TOWERS (LOCK-ON & FIRING)
      let anySniperLocking = false;
      towersRef.current.forEach((tower) => {
        const dist = Math.hypot(p.x - tower.x, p.y - tower.y);
        const targetAngle = Math.atan2(p.y - tower.y, p.x - tower.x);

        if (tower.state === 'COOLDOWN') {
          tower.cooldownTimer -= dt;
          tower.lockProgress = 0;
          if (tower.cooldownTimer <= 0) {
            tower.state = 'SCANNING';
          }
          return;
        }

        if (dist <= tower.range) {
          tower.aimAngle = targetAngle;
          tower.state = 'LOCKING';
          anySniperLocking = true;

          const lockDelta = activelyRewinding
            ? -dt * 0.45
            : dt / tower.lockDuration;
          tower.lockProgress = Math.max(
            0,
            Math.min(1, tower.lockProgress + lockDelta)
          );

          const beepInterval = tower.lockProgress > 0.7 ? 8 : 16;
          if (frameCountRef.current % beepInterval === 0) {
            soundEngine.playSniperLockBeep(tower.lockProgress);
          }

          if (tower.lockProgress >= 1) {
            tower.state = 'COOLDOWN';
            tower.cooldownTimer = 2.4;
            tower.lockProgress = 0;

            const bulletSpeed = 9.2;
            bulletsRef.current.push({
              id: `bullet-${performance.now()}-${tower.id}`,
              towerId: tower.id,
              x: tower.x + Math.cos(tower.aimAngle) * 18,
              y: tower.y + Math.sin(tower.aimAngle) * 18,
              vx: Math.cos(tower.aimAngle) * bulletSpeed,
              vy: Math.sin(tower.aimAngle) * bulletSpeed,
              trail: [{ x: tower.x, y: tower.y }],
              spawnTime: performance.now(),
              dodgedViaRewind: false,
            });

            soundEngine.playSniperFire();
            setCombatLog(
              `${tower.label} FIRED! Hold SPACE to rewind time and dodge the bullet!`
            );
          }
        } else {
          tower.state = 'SCANNING';
          tower.lockProgress = Math.max(0, tower.lockProgress - dt * 0.8);
          tower.aimAngle += Math.sin(frameCountRef.current * 0.02) * 0.01;
        }
      });

      // 4. UPDATE SNIPER BULLETS
      const remainingBullets: SniperBullet[] = [];
      for (const b of bulletsRef.current) {
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 10) b.trail.shift();

        b.x += b.vx;
        b.y += b.vy;

        const distToPlayer = Math.hypot(b.x - p.x, b.y - p.y);
        if (
          activelyRewinding &&
          distToPlayer < TILE_PIXEL_SIZE * 2.2 &&
          !b.dodgedViaRewind
        ) {
          b.dodgedViaRewind = true;
          bulletsDodgedRef.current += 1;
          scoreRef.current += 200;
          setBulletsDodged(bulletsDodgedRef.current);
          setScore(scoreRef.current);
          soundEngine.playBulletDodgedByRewind();
          setCombatLog(
            'PHASE-EVADE! Sniper round dodged via temporal rewind (+200 pts). Watch trailing Wraiths!'
          );
        }

        const hitRadius = activelyRewinding ? 4 : 12;
        if (distToPlayer <= hitRadius) {
          soundEngine.playGameOver(false);
          setHighScore((prev) => Math.max(prev, scoreRef.current));
          setDeathReport({
            reason: 'SNIPER_HEADSHOT',
            killerName: `${b.towerId} Corner Sniper Tower`,
            description:
              'Eliminated by a high-caliber corner turret round. Hold SPACE or SHIFT just as the laser turns solid crimson to rewind backward out of the bullet trajectory.',
            tokensCollected: totalTokensRef.current - tokensLeftRef.current,
            totalTokens: totalTokensRef.current,
            bulletsDodgedByRewind: bulletsDodgedRef.current,
            jumpscaresSurvived: jumpscaresCountRef.current,
            finalScore: scoreRef.current,
            sectorReached: sector,
          });
          setGameState('GAME_OVER');
          return;
        }

        if (
          b.x >= 0 &&
          b.x <= CANVAS_DIMENSION &&
          b.y >= 0 &&
          b.y <= CANVAS_DIMENSION
        ) {
          remainingBullets.push(b);
        }
      }
      bulletsRef.current = remainingBullets;

      // 5. UPDATE FULL-MAP PATROLLING WRAITHS & UNIQUE ABILITIES
      let minWraithTiles = 99;
      for (const w of wraithsRef.current) {
        // Update visual flash timers
        if (w.teleportFlashTimer > 0) {
          w.teleportFlashTimer = Math.max(0, w.teleportFlashTimer - dt);
        }
        if (w.sonarPulseRadius > 0) {
          w.sonarPulseRadius += 420 * dt;
          if (w.sonarPulseRadius > CANVAS_DIMENSION * 1.25) {
            w.sonarPulseRadius = 0;
          }
        }

        // Update Unique Ability State Machine
        if (w.abilityState === 'ACTIVE') {
          w.abilityActiveTimer -= dt;
          if (w.abilityActiveTimer <= 0) {
            w.abilityState = 'COOLDOWN';
            w.abilityCooldown = w.abilityMaxCooldown;
            w.currentSpeed = w.baseSpeed;
            w.sonarTarget = null;
          }
        } else {
          w.abilityCooldown -= dt;
          if (w.abilityCooldown <= 0) {
            // Trigger this Wraith's Unique Ability!
            if (w.abilityType === 'SPEED_SURGE') {
              w.abilityState = 'ACTIVE';
              w.abilityActiveTimer = 3.6;
              w.currentSpeed = w.baseSpeed * 1.65;
              soundEngine.playSpeedSurge();
              setCombatLog(
                `${w.name} activated BLOODLUST SPRINT (1.65x movement speed)!`
              );
            } else if (w.abilityType === 'VOID_TELEPORT') {
              // Teleport to a random open corridor tile at least 4.5 tiles away from player
              const dest = getRandomWalkableTile(
                grid,
                playerGx,
                playerGy,
                4.5
              );
              w.x = dest.x;
              w.y = dest.y;
              w.teleportFlashTimer = 0.85;
              w.abilityState = 'ACTIVE';
              w.abilityActiveTimer = 1.6;
              soundEngine.playTeleportWarp();
              setCombatLog(
                `${w.name} used PHASE BLINK to teleport to sector (${dest.gx}, ${dest.gy})!`
              );
            } else if (w.abilityType === 'SONAR_PING') {
              // Captures a snapshot of where the player is right now ONLY for Blight!
              w.sonarTarget = { x: p.x, y: p.y };
              w.sonarPulseRadius = 8;
              w.abilityState = 'ACTIVE';
              w.abilityActiveTimer = 6.0;
              w.currentSpeed = w.baseSpeed * 1.18;
              soundEngine.playSonarPing();
              setCombatLog(
                `${w.name} emitted an ECHO SONAR SCAN! Only ${w.name} locked onto your snapshot coordinates!`
              );
            } else if (w.abilityType === 'CHRONO_STALK') {
              w.abilityState = 'ACTIVE';
              w.abilityActiveTimer = 4.2;
              w.currentSpeed = w.baseSpeed * 1.38;
              soundEngine.playSpeedSurge();
              setCombatLog(
                `${w.name} activated TIMELINE LOCK—hunting directly along your rewind trail!`
              );
            }
          }
        }

        const wGx = pixelToGrid(w.x);
        const wGy = pixelToGrid(w.y);
        const wCenterX = tileCenter(wGx);
        const wCenterY = tileCenter(wGy);

        // If Wraith reached its current patrol waypoint, assign a new full-map waypoint
        if (Math.hypot(w.x - w.patrolWaypoint.x, w.y - w.patrolWaypoint.y) < TILE_PIXEL_SIZE * 1.5) {
          const nextWp = getRandomWalkableTile(grid, wGx, wGy, 6);
          w.patrolWaypoint = { x: nextWp.x, y: nextWp.y };
        }

        // If a sonar-using wraith reaches the scanned snapshot location, clear the snapshot early
        if (
          w.sonarTarget &&
          Math.hypot(w.x - w.sonarTarget.x, w.y - w.sonarTarget.y) <
            TILE_PIXEL_SIZE * 0.9
        ) {
          w.sonarTarget = null;
        }

        const pixelDistToPlayer = Math.hypot(w.x - p.x, w.y - p.y);
        const tileDistToPlayer = pixelDistToPlayer / TILE_PIXEL_SIZE;

        // Determine target coordinates for BFS full-map navigation
        let targetX = w.patrolWaypoint.x;
        let targetY = w.patrolWaypoint.y;

        if (w.abilityType === 'SONAR_PING') {
          // Blight ONLY knows the player's location when within close visual sight (< 4.5 tiles)
          // OR via the private Sonar Snapshot it captured when triggering Echo Sonar Scan!
          if (w.sonarTarget) {
            targetX = w.sonarTarget.x;
            targetY = w.sonarTarget.y;
          } else if (tileDistToPlayer < 4.5) {
            targetX = p.x;
            targetY = p.y;
          }
        } else if (
          w.abilityType === 'CHRONO_STALK' &&
          timelineRef.current.length > 14
        ) {
          // Dredge stalks the player's recent timeline trail so rewinding into it is lethal
          const trailPt =
            timelineRef.current[Math.max(0, timelineRef.current.length - 18)];
          targetX = trailPt.x;
          targetY = trailPt.y;
        } else if (
          w.abilityType === 'SPEED_SURGE' &&
          (w.abilityState === 'ACTIVE' || tileDistToPlayer < 8.5)
        ) {
          // Vespera aggressively chases when surging or within 8.5 tiles, otherwise patrols map
          targetX = p.x;
          targetY = p.y;
        } else if (w.abilityType === 'VOID_TELEPORT' && tileDistToPlayer < 7.0) {
          // Morrow cuts ahead of the player's movement vector when within 7 tiles
          targetX = Math.max(
            TILE_PIXEL_SIZE,
            Math.min(
              CANVAS_DIMENSION - TILE_PIXEL_SIZE,
              p.x + p.dirX * TILE_PIXEL_SIZE * 3
            )
          );
          targetY = Math.max(
            TILE_PIXEL_SIZE,
            Math.min(
              CANVAS_DIMENSION - TILE_PIXEL_SIZE,
              p.y + p.dirY * TILE_PIXEL_SIZE * 3
            )
          );
        }

        // Navigate intersections & corridors cleanly using BFS
        const distToCenter = Math.hypot(w.x - wCenterX, w.y - wCenterY);
        const wallAheadWraith = isWallTile(
          grid,
          wGx + w.dirX,
          wGy + w.dirY
        );

        if (wallAheadWraith || distToCenter <= w.currentSpeed * 1.15) {
          const targetGx = Math.max(
            1,
            Math.min(GRID_SIZE - 2, pixelToGrid(targetX))
          );
          const targetGy = Math.max(
            1,
            Math.min(GRID_SIZE - 2, pixelToGrid(targetY))
          );

          const nextDir = getNextStepBFS(
            grid,
            wGx,
            wGy,
            targetGx,
            targetGy,
            -w.dirX,
            -w.dirY
          );

          if (nextDir.x !== w.dirX || nextDir.y !== w.dirY) {
            w.x = wCenterX;
            w.y = wCenterY;
            w.dirX = nextDir.x;
            w.dirY = nextDir.y;
          }
        }

        // Advance Wraith along corridor centerline with strict tile-center wall clamping
        const activeWGx = pixelToGrid(w.x);
        const activeWGy = pixelToGrid(w.y);
        const activeWCenterX = tileCenter(activeWGx);
        const activeWCenterY = tileCenter(activeWGy);

        if (w.dirX !== 0) w.y = activeWCenterY;
        if (w.dirY !== 0) w.x = activeWCenterX;

        const wWallInFront = isWallTile(
          grid,
          activeWGx + w.dirX,
          activeWGy + w.dirY
        );

        let nextWX = w.x + w.dirX * w.currentSpeed;
        let nextWY = w.y + w.dirY * w.currentSpeed;

        if (wWallInFront) {
          if (w.dirX > 0 && nextWX >= activeWCenterX) nextWX = activeWCenterX;
          if (w.dirX < 0 && nextWX <= activeWCenterX) nextWX = activeWCenterX;
          if (w.dirY > 0 && nextWY >= activeWCenterY) nextWY = activeWCenterY;
          if (w.dirY < 0 && nextWY <= activeWCenterY) nextWY = activeWCenterY;
        }

        w.x = nextWX;
        w.y = nextWY;

        const updatedDist = Math.hypot(w.x - p.x, w.y - p.y);
        const updatedTileDist = updatedDist / TILE_PIXEL_SIZE;
        w.distanceToPlayer = updatedTileDist;
        w.isTrailingClosely = updatedTileDist < 4.2;

        if (updatedTileDist < minWraithTiles) {
          minWraithTiles = updatedTileDist;
        }

        // Check Wraith collision with Player
        if (updatedDist < TILE_PIXEL_SIZE * 0.62) {
          const isParadoxDeath = activelyRewinding;
          soundEngine.playGameOver(isParadoxDeath);
          setHighScore((prev) => Math.max(prev, scoreRef.current));
          setDeathReport({
            reason: isParadoxDeath ? 'TEMPORAL_PARADOX_WRAITH' : 'WRAITH_CAUGHT',
            killerName: `${w.name} (${w.abilityName})`,
            description: isParadoxDeath
              ? `TEMPORAL PARADOX FATALITY: You rewound backwards in time to dodge a threat, but ${w.name} was trailing right behind your past timeline and caught you!`
              : `Intercepted in the labyrinth by ${w.name} using ${w.abilityName}. Watch enemy ability cooldowns and use intersections to break line of sight.`,
            tokensCollected: totalTokensRef.current - tokensLeftRef.current,
            totalTokens: totalTokensRef.current,
            bulletsDodgedByRewind: bulletsDodgedRef.current,
            jumpscaresSurvived: jumpscaresCountRef.current,
            finalScore: scoreRef.current,
            sectorReached: sector,
          });
          setGameState('GAME_OVER');
          return;
        }
      }

      // 6. OCCASIONAL PSYCHOLOGICAL JUMPSCARES
      const scareChance =
        difficulty === 'NIGHTMARE'
          ? 0.0022
          : difficulty === 'STALKER'
          ? 0.0014
          : 0.0008;
      if (
        (minWraithTiles < 3.5 || anySniperLocking) &&
        Math.random() < scareChance
      ) {
        triggerJumpscare(
          anySniperLocking ? 'SNIPER_PROXIMITY' : 'WRAITH_WHISPER'
        );
      }

      // 7. PERIODIC UI TELEMETRY SYNC
      if (frameCountRef.current % 6 === 0) {
        setChronoCharge(Math.round(chronoChargeRef.current));
        setClosestWraithDist(Number(minWraithTiles.toFixed(1)));
        setParadoxRiskStatus(
          minWraithTiles < 2.6
            ? 'CRITICAL'
            : minWraithTiles < 4.5
            ? 'CAUTION'
            : 'SAFE'
        );
        setTowerTelemetry(
          towersRef.current.map((t) => ({
            id: t.id,
            label: t.label,
            state: t.state,
            lockPct: Math.round(t.lockProgress * 100),
          }))
        );
        setWraithTelemetry(
          wraithsRef.current.map((w) => ({
            id: w.id,
            name: w.name,
            abilityName: w.abilityName,
            abilityState: w.abilityState,
            cooldownSec:
              w.abilityState === 'ACTIVE'
                ? Number(w.abilityActiveTimer.toFixed(1))
                : Number(Math.max(0, w.abilityCooldown).toFixed(1)),
            color: w.color,
          }))
        );
      }

      // 8. RENDER LABYRINTH & ENTITIES TO CANVAS
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawGameFrame(ctx, activelyRewinding);
        }
      }

      animationFrameId = requestAnimationFrame(updateAndRender);
    };

    animationFrameId = requestAnimationFrame(updateAndRender);
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState, difficulty, sector, triggerJumpscare]);

  // Canvas Drawing Routine
  const drawGameFrame = (
    ctx: CanvasRenderingContext2D,
    activelyRewinding: boolean
  ) => {
    const grid = mazeGridRef.current;
    const p = playerRef.current;

    // Background Abyss
    ctx.fillStyle = activelyRewinding ? '#091926' : '#080B11';
    ctx.fillRect(0, 0, CANVAS_DIMENSION, CANVAS_DIMENSION);

    // Draw Corner Sniper Range Rings
    towersRef.current.forEach((tower) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, tower.range, 0, Math.PI * 2);
      ctx.strokeStyle =
        tower.state === 'LOCKING'
          ? `rgba(239, 68, 68, ${0.15 + tower.lockProgress * 0.3})`
          : 'rgba(148, 163, 184, 0.07)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.restore();
    });

    // Draw Maze Walls, Golden Tokens, and Flux Crystals
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = grid[r][c];
        const x = c * TILE_PIXEL_SIZE;
        const y = r * TILE_PIXEL_SIZE;

        if (cell === 1) {
          ctx.fillStyle = '#131B2E';
          ctx.fillRect(x + 1, y + 1, TILE_PIXEL_SIZE - 2, TILE_PIXEL_SIZE - 2);
          ctx.strokeStyle = '#1E293B';
          ctx.lineWidth = 1;
          ctx.strokeRect(
            x + 1.5,
            y + 1.5,
            TILE_PIXEL_SIZE - 3,
            TILE_PIXEL_SIZE - 3
          );
        } else if (cell === 0) {
          const cx = x + TILE_PIXEL_SIZE / 2;
          const cy = y + TILE_PIXEL_SIZE / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
          ctx.fillStyle = '#F59E0B';
          ctx.fill();
        } else if (cell === 3) {
          const cx = x + TILE_PIXEL_SIZE / 2;
          const cy = y + TILE_PIXEL_SIZE / 2;
          const pulse = 6.5 + Math.sin(frameCountRef.current * 0.1) * 1.8;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(frameCountRef.current * 0.03);
          ctx.fillStyle = '#22D3EE';
          ctx.shadowColor = '#22D3EE';
          ctx.shadowBlur = 10;
          ctx.fillRect(-pulse / 2, -pulse / 2, pulse, pulse);
          ctx.restore();
        }
      }
    }

    // Draw Player's Past Timeline Echoes
    const history = timelineRef.current;
    if (history.length > 2) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < history.length; i += 3) {
        const pt = history[i];
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = activelyRewinding
        ? 'rgba(34, 211, 238, 0.75)'
        : 'rgba(34, 211, 238, 0.24)';
      ctx.lineWidth = activelyRewinding ? 3 : 1.5;
      ctx.stroke();

      for (let i = 0; i < history.length; i += 18) {
        const pt = history[i];
        const alpha = (i / history.length) * (activelyRewinding ? 0.65 : 0.28);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34, 211, 238, ${alpha})`;
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw Wraith Unique Ability Visual Effects (Sonar Wave & Exclusive Snapshot Ping, Teleport Rift)
    wraithsRef.current.forEach((w) => {
      // Expanding Sonar Ring from Blight
      if (w.sonarPulseRadius > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.sonarPulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();
      }

      // Exclusive Sonar Snapshot Marker & Private Vector Line (known ONLY to the Wraith that cast Sonar!)
      if (w.sonarTarget && w.abilityState === 'ACTIVE') {
        ctx.save();
        // Dashed private link from Blight to the scanned player snapshot
        ctx.beginPath();
        ctx.moveTo(w.x, w.y);
        ctx.lineTo(w.sonarTarget.x, w.sonarTarget.y);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();

        // Pulsing Sonar Ping Beacon at scanned coordinates
        const pingRadius =
          10 + Math.sin(frameCountRef.current * 0.25) * 4;
        ctx.beginPath();
        ctx.arc(
          w.sonarTarget.x,
          w.sonarTarget.y,
          pingRadius,
          0,
          Math.PI * 2
        );
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(w.sonarTarget.x, w.sonarTarget.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#10B981';
        ctx.fill();
        ctx.restore();
      }

      // Teleport Arrival Rift Ring for Morrow
      if (w.teleportFlashTimer > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(
          w.x,
          w.y,
          TILE_PIXEL_SIZE * (0.5 + (1 - w.teleportFlashTimer) * 0.9),
          0,
          Math.PI * 2
        );
        ctx.strokeStyle = `rgba(168, 85, 247, ${w.teleportFlashTimer})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    });

    // Draw Sniper Laser Sight Beams
    towersRef.current.forEach((tower) => {
      if (tower.state === 'LOCKING') {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(tower.x, tower.y);
        ctx.lineTo(p.x, p.y);

        const isImminent = tower.lockProgress > 0.75;
        ctx.strokeStyle = isImminent
          ? 'rgba(239, 68, 68, 0.95)'
          : `rgba(245, 158, 11, ${0.35 + tower.lockProgress * 0.5})`;
        ctx.lineWidth = isImminent ? 2.6 : 1.4;
        if (!isImminent) {
          ctx.setLineDash([8, 6]);
        }
        ctx.stroke();

        ctx.beginPath();
        const reticleRadius =
          TILE_PIXEL_SIZE * (1.2 - tower.lockProgress * 0.55);
        ctx.arc(p.x, p.y, reticleRadius, 0, Math.PI * 2);
        ctx.strokeStyle = isImminent ? '#EF4444' : '#F59E0B';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
      }
    });

    // Draw 4 Corner Sniper Towers
    towersRef.current.forEach((tower) => {
      ctx.save();
      ctx.translate(tower.x, tower.y);

      ctx.fillStyle = '#1E293B';
      ctx.strokeStyle =
        tower.state === 'LOCKING'
          ? '#EF4444'
          : tower.state === 'COOLDOWN'
          ? '#64748B'
          : '#F59E0B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, TILE_PIXEL_SIZE * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.rotate(tower.aimAngle);
      ctx.fillStyle = tower.state === 'LOCKING' ? '#EF4444' : '#94A3B8';
      ctx.fillRect(0, -3, TILE_PIXEL_SIZE * 0.65, 6);

      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fillStyle =
        tower.state === 'LOCKING'
          ? '#EF4444'
          : tower.state === 'COOLDOWN'
          ? '#38BDF8'
          : '#F59E0B';
      ctx.fill();
      ctx.restore();
    });

    // Draw High-Velocity Sniper Bullets
    bulletsRef.current.forEach((b) => {
      ctx.save();
      if (b.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(b.trail[0].x, b.trail[0].y);
        for (let i = 1; i < b.trail.length; i++) {
          ctx.lineTo(b.trail[i].x, b.trail[i].y);
        }
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FEF08A';
      ctx.shadowColor = '#EF4444';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.restore();
    });

    // Draw Patrolling Enemy Wraiths
    wraithsRef.current.forEach((w) => {
      ctx.save();
      ctx.translate(w.x, w.y);

      // Active Ability Aura Ring
      if (w.abilityState === 'ACTIVE') {
        ctx.beginPath();
        ctx.arc(0, 0, TILE_PIXEL_SIZE * 0.56, 0, Math.PI * 2);
        ctx.strokeStyle = w.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Danger ring if player is rewinding or wraith is dangerously close
      if (w.isTrailingClosely) {
        ctx.beginPath();
        ctx.arc(
          0,
          0,
          TILE_PIXEL_SIZE * 0.65 + Math.sin(frameCountRef.current * 0.2) * 2,
          0,
          Math.PI * 2
        );
        ctx.strokeStyle = activelyRewinding
          ? '#EF4444'
          : 'rgba(239, 68, 68, 0.4)';
        ctx.lineWidth = activelyRewinding ? 2.2 : 1.2;
        ctx.stroke();
      }

      // Wraith Shroud Body
      const r = TILE_PIXEL_SIZE * 0.4;
      ctx.fillStyle = w.color;
      ctx.shadowColor = w.glowColor;
      ctx.shadowBlur = w.abilityState === 'ACTIVE' ? 16 : 10;

      ctx.beginPath();
      ctx.arc(0, -2, r, Math.PI, 0, false);
      ctx.lineTo(r, r);
      const waveCount = 3;
      const waveWidth = (r * 2) / waveCount;
      for (let i = 0; i < waveCount; i++) {
        const wx = r - i * waveWidth;
        ctx.lineTo(wx - waveWidth / 2, r - 4);
        ctx.lineTo(wx - waveWidth, r);
      }
      ctx.closePath();
      ctx.fill();

      // Glowing Hollow Eyes looking in movement direction
      const eyeOffsetX = w.dirX * 2.5;
      const eyeOffsetY = w.dirY * 2.5;
      ctx.fillStyle = '#080B11';
      ctx.beginPath();
      ctx.arc(-4 + eyeOffsetX, -3 + eyeOffsetY, 2.8, 0, Math.PI * 2);
      ctx.arc(4 + eyeOffsetX, -3 + eyeOffsetY, 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.arc(
        -4 + eyeOffsetX * 1.3,
        -3 + eyeOffsetY * 1.3,
        1.2,
        0,
        Math.PI * 2
      );
      ctx.arc(
        4 + eyeOffsetX * 1.3,
        -3 + eyeOffsetY * 1.3,
        1.2,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.restore();
    });

    // Draw Player (Chrono-Pac Runner)
    ctx.save();
    ctx.translate(p.x, p.y);

    // Subtle Pac-Man buffered turn indicator arrow if player has pre-buffered a turn
    if (
      !activelyRewinding &&
      (p.nextDirX !== 0 || p.nextDirY !== 0) &&
      (p.nextDirX !== p.dirX || p.nextDirY !== p.dirY)
    ) {
      ctx.save();
      const indicatorDist = TILE_PIXEL_SIZE * 0.58;
      ctx.translate(p.nextDirX * indicatorDist, p.nextDirY * indicatorDist);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.75)';
      ctx.beginPath();
      ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const angle =
      p.dirX === 1
        ? 0
        : p.dirX === -1
        ? Math.PI
        : p.dirY === -1
        ? -Math.PI / 2
        : p.dirY === 1
        ? Math.PI / 2
        : 0;
    ctx.rotate(angle);

    const playerRadius = TILE_PIXEL_SIZE * 0.42;
    ctx.fillStyle = activelyRewinding ? '#22D3EE' : '#F59E0B';
    ctx.shadowColor = activelyRewinding ? '#22D3EE' : '#F59E0B';
    ctx.shadowBlur = activelyRewinding ? 16 : 8;

    ctx.beginPath();
    ctx.arc(
      0,
      0,
      playerRadius,
      p.mouthAngle * Math.PI,
      (2 - p.mouthAngle) * Math.PI
    );
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Subtle VHS Rewind Scanline Tint when Rewinding Time
    if (activelyRewinding) {
      ctx.save();
      ctx.fillStyle = 'rgba(34, 211, 238, 0.08)';
      for (let y = 0; y < CANVAS_DIMENSION; y += 6) {
        ctx.fillRect(0, y, CANVAS_DIMENSION, 2);
      }
      ctx.restore();
    }
  };

  const setDirectionInput = (dx: number, dy: number) => {
    playerRef.current.nextDirX = dx;
    playerRef.current.nextDirY = dy;
  };

  return (
    <div className="min-h-screen bg-[#080B11] text-slate-100 flex flex-col justify-between">
      {/* Full-Screen Psychological Jumpscare Overlay */}
      <JumpscareOverlay
        activeScare={activeJumpscare}
        reducedTerror={reducedTerror}
      />

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="w-full border-b border-slate-800/80 bg-[#080B11]/95 backdrop-blur-xs sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-6 py-3.5 flex items-center justify-between">
          {/* Zone 1: Single Text Element Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setGameState('TITLE_MENU');
            }}
            className="text-lg font-display font-bold tracking-wider text-slate-100 hover:text-amber-400 transition-colors whitespace-nowrap"
          >
            CHRONO-MAW
          </a>

          {/* Zone 2: Clean Text Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <button
              type="button"
              onClick={() => setGameState('TITLE_MENU')}
              className={`hover:text-slate-100 transition-colors cursor-pointer whitespace-nowrap ${
                gameState === 'TITLE_MENU'
                  ? 'text-slate-100 underline underline-offset-8 decoration-amber-500'
                  : ''
              }`}
            >
              Mission Briefing
            </button>
            <button
              type="button"
              onClick={() => {
                if (gameState === 'TITLE_MENU') handleStartNewGame();
              }}
              className={`hover:text-slate-100 transition-colors cursor-pointer whitespace-nowrap ${
                gameState === 'PLAYING' || gameState === 'PAUSED'
                  ? 'text-slate-100 underline underline-offset-8 decoration-amber-500'
                  : ''
              }`}
            >
              Active Labyrinth
            </button>
            <button
              type="button"
              onClick={() => triggerJumpscare('MANUAL_TEST')}
              className="hover:text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              Test Jumpscare
            </button>
            <button
              type="button"
              onClick={() => setReducedTerror((prev) => !prev)}
              className="hover:text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              {reducedTerror ? 'Horror Mode: Reduced' : 'Horror Mode: Full'}
            </button>
          </nav>

          {/* Zone 3: 1-2 Primary Actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            >
              {muted ? (
                <VolumeX className="w-4 h-4 text-slate-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-amber-400" />
              )}
              <span>{muted ? 'Muted' : 'Audio On'}</span>
            </button>

            <button
              type="button"
              onClick={handleStartNewGame}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {gameState === 'TITLE_MENU' ? 'Start Expedition' : 'Restart Run'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center">
        {gameState === 'TITLE_MENU' ? (
          <HowToPlayModal
            difficulty={difficulty}
            setDifficulty={setDifficulty}
            reducedTerror={reducedTerror}
            setReducedTerror={setReducedTerror}
            muted={muted}
            setMuted={setMuted}
            onStartGame={handleStartNewGame}
            onTriggerSampleScare={() => triggerJumpscare('MANUAL_TEST')}
            heroImageUrl={chronoMazeHeroImg}
          />
        ) : (
          /* Active Play / Pause / Game Over Viewport */
          <div className="w-full max-w-[1380px] mx-auto px-4 md:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left / Center 8 Columns: Labyrinth Arena Canvas */}
            <div className="lg:col-span-8 flex flex-col items-center">
              {/* Top Unobtrusive Tactical Strip */}
              <div className="w-full max-w-[672px] mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular text-slate-300 bg-[#0F141F] border border-slate-800/80 px-4 py-2.5 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-semibold">
                    SCORE: {score.toLocaleString()}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    TOKENS: {totalTokensInSector - tokensRemaining}/
                    {totalTokensInSector}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>SECTOR 0{sector}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span>DODGED: {bulletsDodged}</span>
                  <span aria-hidden="true">·</span>
                  <span>SCARES: {jumpscaresSurvived}</span>
                </div>
              </div>

              {/* Game Canvas Container */}
              <div className="relative w-full max-w-[672px] aspect-square bg-[#080B11] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                <canvas
                  ref={canvasRef}
                  width={CANVAS_DIMENSION}
                  height={CANVAS_DIMENSION}
                  className="w-full h-full block"
                />

                {/* Rewind Active Status Banner */}
                {isRewindingUI && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none bg-cyan-950/90 border border-cyan-400/70 px-4 py-1.5 rounded-lg flex items-center gap-2 text-xs font-mono-tabular text-cyan-200 shadow-lg">
                    <History className="w-4 h-4 animate-spin" />
                    <span>REWINDING TIMELINE · WATCH TRAILING WRAITHS</span>
                  </div>
                )}

                {/* PAUSED OVERLAY */}
                {gameState === 'PAUSED' && (
                  <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-20">
                    <p className="text-xs font-mono-tabular text-amber-400">
                      Tactical Feed Suspended · Sector 0{sector}
                    </p>
                    <h2 className="text-3xl font-display font-bold text-slate-100 mt-1 mb-6">
                      Labyrinth Paused
                    </h2>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setGameState('PLAYING')}
                        className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>Resume Expedition</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleStartNewGame}
                        className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-xs rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Restart Sector
                      </button>
                    </div>
                  </div>
                )}

                {/* SECTOR VICTORY / ROUND SUMMARY MODAL */}
                {gameState === 'ROUND_SUMMARY' && (
                  <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xs flex flex-col items-center justify-center p-8 text-center z-20">
                    <Trophy className="w-12 h-12 text-amber-400 mb-3" />
                    <p className="text-xs font-mono-tabular text-emerald-400">
                      All Chrono-Tokens Harvested · Sector 0{sector} Cleared
                    </p>
                    <h2 className="text-3xl font-display font-bold text-slate-100 mt-1">
                      Vault Sector Purged
                    </h2>
                    <p className="text-sm text-slate-300 max-w-md mt-2 mb-6">
                      You survived the corner sniper bastions and outmaneuvered your own past. Deeper sectors accelerate Wraith pursuit speeds.
                    </p>

                    <div className="w-full max-w-xs space-y-2 text-xs font-mono-tabular border-y border-slate-800 py-4 mb-6">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Current Score</span>
                        <span className="text-amber-400 font-semibold">
                          {score.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          Sniper Rounds Dodged
                        </span>
                        <span className="text-cyan-400">{bulletsDodged}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          Jumpscares Survived
                        </span>
                        <span className="text-purple-400">
                          {jumpscaresSurvived}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleNextSector}
                      className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Descend to Sector 0{sector + 1}</span>
                    </button>
                  </div>
                )}

                {/* GAME OVER / AUTOPSY MODAL */}
                {gameState === 'GAME_OVER' && deathReport && (
                  <div className="absolute inset-0 bg-slate-950/92 backdrop-blur-xs flex flex-col items-center justify-center p-6 md:p-8 text-center z-20">
                    <Skull className="w-12 h-12 text-red-500 mb-3" />
                    <div className="flex items-center gap-2 text-xs font-mono-tabular text-red-400">
                      <span>
                        {deathReport.reason === 'TEMPORAL_PARADOX_WRAITH'
                          ? 'TEMPORAL PARADOX COLLISION'
                          : deathReport.reason === 'SNIPER_HEADSHOT'
                          ? 'BALLISTIC TERMINATION'
                          : 'CORRIDOR AMBUSH'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>SECTOR 0{deathReport.sectorReached}</span>
                    </div>

                    <h2
                      className="text-2xl md:text-3xl font-display font-bold text-slate-100 mt-1"
                      style={{ textWrap: 'balance' }}
                    >
                      {deathReport.killerName}
                    </h2>

                    <p className="text-xs md:text-sm text-slate-300 max-w-md mt-2 mb-6 leading-relaxed">
                      {deathReport.description}
                    </p>

                    <div className="w-full max-w-sm space-y-2 text-xs font-mono-tabular border-y border-slate-800 py-4 mb-6">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Final Score</span>
                        <span className="text-amber-400 font-semibold">
                          {deathReport.finalScore.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Tokens Harvested</span>
                        <span className="text-slate-200">
                          {deathReport.tokensCollected} /{' '}
                          {deathReport.totalTokens}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          Bullets Dodged via Rewind
                        </span>
                        <span className="text-cyan-400">
                          {deathReport.bulletsDodgedByRewind}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          Jumpscares Survived
                        </span>
                        <span className="text-purple-400">
                          {deathReport.jumpscaresSurvived}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleStartNewGame}
                        className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Play Again</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setGameState('TITLE_MENU')}
                        className="px-5 py-3 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-xs rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Briefing Menu
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile / Touch Directional & Rewind Control Deck */}
              <div className="w-full max-w-[672px] mt-4 grid grid-cols-2 gap-4 items-center bg-[#0F141F] border border-slate-800/80 p-4 rounded-xl">
                <div className="flex items-center gap-2 justify-center sm:justify-start">
                  <button
                    type="button"
                    onClick={() => setDirectionInput(-1, 0)}
                    className="w-11 h-11 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                    aria-label="Move Left"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setDirectionInput(0, -1)}
                      className="w-11 h-11 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                      aria-label="Move Up"
                    >
                      <ArrowUp className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirectionInput(0, 1)}
                      className="w-11 h-11 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                      aria-label="Move Down"
                    >
                      <ArrowDown className="w-5 h-5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDirectionInput(1, 0)}
                    className="w-11 h-11 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                    aria-label="Move Right"
                  >
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <button
                    type="button"
                    onMouseDown={() => {
                      if (
                        chronoChargeRef.current > 5 &&
                        timelineRef.current.length > 2
                      ) {
                        isRewindingRef.current = true;
                        setIsRewindingUI(true);
                      }
                    }}
                    onMouseUp={() => {
                      isRewindingRef.current = false;
                      setIsRewindingUI(false);
                    }}
                    onMouseLeave={() => {
                      isRewindingRef.current = false;
                      setIsRewindingUI(false);
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      if (
                        chronoChargeRef.current > 5 &&
                        timelineRef.current.length > 2
                      ) {
                        isRewindingRef.current = true;
                        setIsRewindingUI(true);
                      }
                    }}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      isRewindingRef.current = false;
                      setIsRewindingUI(false);
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all whitespace-nowrap cursor-pointer select-none ${
                      isRewindingUI
                        ? 'bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/25'
                        : 'bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-200 border border-cyan-500/50'
                    }`}
                  >
                    <History className="w-4 h-4" />
                    <span>Hold to Rewind Time (SPACE)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right 4 Columns: Tactical Telemetry & Paradox Monitor */}
            <aside className="lg:col-span-4 bg-[#0F141F] border border-slate-800/80 rounded-2xl p-6 space-y-5">
              {/* Section 1: Temporal Rewind Capacitor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-cyan-400" />
                    <span>Chrono-Rewind Capacitor</span>
                  </span>
                  <span className="font-mono-tabular text-cyan-400 font-semibold">
                    {chronoCharge}% ·{' '}
                    {chronoCharge > 20 ? 'READY' : 'LOW CHARGE'}
                  </span>
                </div>

                <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-75"
                    style={{ width: `${chronoCharge}%` }}
                  />
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Hold{' '}
                  <span className="text-slate-200 font-mono-tabular">
                    SPACE
                  </span>{' '}
                  to snap backward along your cyan path and evade sniper rounds.
                </p>
              </div>

              {/* Section 2: Trailing Wraith Paradox Risk Meter */}
              <div className="pt-4 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <span>Rewind Paradox Risk</span>
                  </span>
                  <span
                    className={`font-mono-tabular font-semibold ${
                      paradoxRiskStatus === 'CRITICAL'
                        ? 'text-red-400'
                        : paradoxRiskStatus === 'CAUTION'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {paradoxRiskStatus} · {closestWraithDist} TILES
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {paradoxRiskStatus === 'CRITICAL'
                    ? 'DANGER: A Wraith is directly on your past timeline! Rewinding now will pull you straight into it!'
                    : paradoxRiskStatus === 'CAUTION'
                    ? 'CAUTION: Wraiths are closing in behind you. Keep time-rewinds brief.'
                    : 'CLEAR: Safe distance from trailing Wraiths to rewind time.'}
                </p>
              </div>

              {/* Section 3: Patrolling Wraiths & Unique Abilities */}
              <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Ghost className="w-4 h-4 text-purple-400" />
                    <span>Wraith Patrol & Abilities</span>
                  </span>
                  <span className="text-slate-400 font-mono-tabular">
                    FULL-MAP AI
                  </span>
                </div>

                <div className="space-y-1.5">
                  {wraithTelemetry.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/60 font-mono-tabular"
                    >
                      <span className="text-slate-200">
                        {w.name} ·{' '}
                        <span className="text-slate-400">{w.abilityName}</span>
                      </span>
                      <span
                        className={
                          w.abilityState === 'ACTIVE'
                            ? 'text-amber-400 font-semibold'
                            : 'text-slate-400'
                        }
                      >
                        {w.abilityState === 'ACTIVE'
                          ? `ACTIVE · ${w.cooldownSec}s`
                          : `CD · ${w.cooldownSec}s`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 4: 4 Corner Sniper Bastion Telemetry */}
              <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Crosshair className="w-4 h-4 text-red-400" />
                    <span>Corner Sniper Bastions</span>
                  </span>
                  <span className="text-slate-400 font-mono-tabular">
                    4 TURRETS
                  </span>
                </div>

                <div className="space-y-1.5">
                  {towerTelemetry.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60 font-mono-tabular"
                    >
                      <span className="text-slate-300">{t.label}</span>
                      <span
                        className={
                          t.state === 'LOCKING'
                            ? 'text-red-400 font-semibold'
                            : t.state === 'COOLDOWN'
                            ? 'text-cyan-400'
                            : 'text-slate-400'
                        }
                      >
                        {t.state === 'LOCKING'
                          ? `LOCKING · ${t.lockPct}%`
                          : t.state === 'COOLDOWN'
                          ? 'RELOADING'
                          : 'SCANNING'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 5: Live Tactical Feed & Session Controls */}
              <div className="pt-4 border-t border-slate-800/80 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-1">
                    Tactical Advisory
                  </div>
                  <p className="text-xs text-amber-300/90 font-mono-tabular leading-relaxed bg-slate-950/90 border border-slate-800 p-3 rounded-xl">
                    {combatLog}
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs font-mono-tabular text-slate-400 pt-1">
                  <span>HIGH SCORE: {highScore.toLocaleString()}</span>
                  <span>·</span>
                  <span>MODE: {difficulty}</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setGameState((prev) =>
                        prev === 'PLAYING' ? 'PAUSED' : 'PLAYING'
                      )
                    }
                    className="py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {gameState === 'PAUSED' ? (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>Resume</span>
                      </>
                    ) : (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        <span>Pause</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerJumpscare('MANUAL_TEST')}
                    className="py-2.5 px-4 bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-800/50 rounded-xl text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    Trigger Scare
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="w-full border-t border-slate-900 py-4 px-6 text-center text-xs text-slate-500">
        Chrono-Maw: Labyrinth of Echoes · Use WASD or Arrow Keys to move and SPACE to rewind time.
      </footer>
    </div>
  );
}
