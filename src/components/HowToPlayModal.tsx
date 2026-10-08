import React from 'react';
import { DifficultyLevel } from '../types/game';
import { Crosshair, History, Ghost, Sparkles, Play, Volume2, VolumeX, Eye } from 'lucide-react';

interface HowToPlayModalProps {
  difficulty: DifficultyLevel;
  setDifficulty: (diff: DifficultyLevel) => void;
  reducedTerror: boolean;
  setReducedTerror: (val: boolean) => void;
  muted: boolean;
  setMuted: (val: boolean) => void;
  onStartGame: () => void;
  onTriggerSampleScare: () => void;
  heroImageUrl: string;
}

export const HowToPlayModal: React.FC<HowToPlayModalProps> = ({
  difficulty,
  setDifficulty,
  reducedTerror,
  setReducedTerror,
  muted,
  setMuted,
  onStartGame,
  onTriggerSampleScare,
  heroImageUrl,
}) => {
  const [imgFailed, setImgFailed] = React.useState(false);

  return (
    <div className="w-full max-w-[1280px] mx-auto px-6 py-8">
      {/* Main Hero & Briefing Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 7 Columns: Visual Showcase & Core Concept */}
        <div className="lg:col-span-7 bg-[#0F141F] border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="relative aspect-16/9 w-full bg-slate-950 overflow-hidden">
            {!imgFailed ? (
              <img
                src={heroImageUrl}
                alt="Subterranean Labyrinth with Corner Sniper Towers and Trailing Wraiths"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-amber-950/30 p-8">
                <Crosshair className="w-16 h-16 text-amber-500/50" />
              </div>
            )}
            {/* Measured Scrim Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0F141F] via-[#0F141F]/45 to-transparent" />

            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
              <div className="flex items-center gap-2 text-xs text-amber-400 font-mono-tabular mb-2">
                <span>Tactical Survival Arcade</span>
                <span aria-hidden="true">·</span>
                <span>4 Corner Sniper Bastions</span>
                <span aria-hidden="true">·</span>
                <span>Temporal Rewind Physics</span>
              </div>
              <h1
                className="text-2xl md:text-4xl font-display font-bold text-slate-100 tracking-tight"
                style={{ textWrap: 'balance' }}
              >
                Harvest the Labyrinth Before Your Own Past Catches Up
              </h1>
            </div>
          </div>

          <div className="p-6 md:p-8 space-y-6">
            <p className="text-slate-300 text-base leading-relaxed max-w-[68ch]">
              Navigate the subterranean vault to collect every golden Chrono-Token while four shadowy Wraiths stalk the corridors behind you. Four automated Sniper Towers guard the corners—when their crimson lasers lock onto your signature, normal movement cannot outrun a high-velocity round.
            </p>

            {/* 4 Key Mechanics Breakdown (Whitespace + Hairline Dividers, No Nested Cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-800/80">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>01. Collect Chrono-Tokens</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Clear all golden tokens and Temporal Flux Crystals in the maze to unlock the next sector. Flux Crystals immediately replenish 35% of your rewind capacitor.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
                  <Crosshair className="w-4 h-4 shrink-0" />
                  <span>02. Corner Sniper Bastions</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Entering a corner sector triggers a turret lock-on. Watch the laser sight transition from scanning amber to solid crimson before the sniper fires a lethal round.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                  <History className="w-4 h-4 shrink-0" />
                  <span>03. Dodge by Rewinding Time</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Hold <span className="text-slate-200 font-mono-tabular">SPACE</span> or <span className="text-slate-200 font-mono-tabular">SHIFT</span> as a sniper fires to snap your body backward along your recorded timeline trail—Phase-Evading the bullet mid-flight.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-purple-400 font-semibold text-sm">
                  <Ghost className="w-4 h-4 shrink-0" />
                  <span>04. Wraith Abilities & Paradox Trap</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Each Wraith patrols the entire labyrinth with a unique ability: <strong>Speed Surge</strong>, <strong>Void Teleportation</strong>, an <strong>Exclusive Sonar Scan</strong> (revealing your snapshot coordinates only to that Wraith), and <strong>Timeline Stalking</strong>. Rewinding into a trailing Wraith is fatal!
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Expedition Setup & Launch Controls */}
        <div className="lg:col-span-5 bg-[#0F141F] border border-slate-800/80 rounded-2xl p-6 md:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-6">
            <div>
              <p className="text-xs text-slate-400 font-mono-tabular">
                Expedition Configuration · Sector 01
              </p>
              <h2 className="text-xl font-display font-bold text-slate-100 mt-1">
                Configure Threat Parameters
              </h2>
            </div>

            {/* Interactive Segmented Difficulty Control */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                Threat Intensity & Sniper Lock Speed
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800/80">
                {(['INITIATE', 'STALKER', 'NIGHTMARE'] as DifficultyLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDifficulty(level)}
                    className={`py-2 px-3 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                      difficulty === level
                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {level === 'INITIATE'
                      ? 'Initiate'
                      : level === 'STALKER'
                      ? 'Stalker'
                      : 'Nightmare'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 pt-1">
                {difficulty === 'INITIATE' &&
                  '1.6s sniper lock-on window · Moderate Wraith pursuit speed · Occasional jumpscares.'}
                {difficulty === 'STALKER' &&
                  '1.15s sniper lock-on window · Aggressive Wraith flanking · Frequent psychological jumpscares.'}
                {difficulty === 'NIGHTMARE' &&
                  '0.85s hair-trigger snipers · Relentless Wraith pack · High-frequency jumpscare anomalies.'}
              </p>
            </div>

            {/* Controls Reference Table */}
            <div className="space-y-2.5 pt-4 border-t border-slate-800/80">
              <h3 className="text-xs font-semibold text-slate-300">
                Tactical Controls Reference
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50">
                  <span className="text-slate-400">Navigate Labyrinth</span>
                  <span className="font-mono-tabular text-slate-200">WASD / Arrow Keys</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50">
                  <span className="text-slate-400">Chrono-Rewind (Dodge Bullet)</span>
                  <span className="font-mono-tabular text-cyan-400 font-semibold">Hold SPACE or SHIFT</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50">
                  <span className="text-slate-400">Pause Tactical Feed</span>
                  <span className="font-mono-tabular text-slate-200">P or ESC</span>
                </div>
              </div>
            </div>

            {/* Sensory & Accessibility Switches */}
            <div className="space-y-3 pt-4 border-t border-slate-800/80">
              <h3 className="text-xs font-semibold text-slate-300">
                Sensory & Jumpscare Calibration
              </h3>

              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <div className="text-xs font-medium text-slate-200">
                    Synthesized Audio Stingers
                  </div>
                  <div className="text-xs text-slate-400">
                    Sniper lock-on alarms, rewind tape warble & horror chords
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMuted(!muted)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    !muted
                      ? 'bg-slate-800/90 border-slate-700 text-emerald-400'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {!muted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  <span>{!muted ? 'Audio Active' : 'Muted'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <div className="text-xs font-medium text-slate-200">
                    Full-Screen Jumpscare Shocks
                  </div>
                  <div className="text-xs text-slate-400">
                    Sudden spectral hallucinations when cornered or targeted
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReducedTerror(!reducedTerror)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    !reducedTerror
                      ? 'bg-red-950/60 border-red-700/60 text-red-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <Eye className="w-4 h-4" />
                  <span>{!reducedTerror ? 'Full Horror' : 'Reduced Flash'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Primary Launch CTAs */}
          <div className="pt-4 border-t border-slate-800/80 space-y-3">
            <button
              type="button"
              onClick={onStartGame}
              className="w-full py-3.5 px-6 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-semibold text-sm rounded-xl shadow-lg shadow-amber-500/10 transition-all flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Enter the Labyrinth</span>
            </button>

            <button
              type="button"
              onClick={onTriggerSampleScare}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-medium rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              Test Jumpscare Anomaly Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
