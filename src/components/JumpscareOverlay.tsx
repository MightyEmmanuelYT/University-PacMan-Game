import React from 'react';
import { JumpscareEvent } from '../types/game';
import { AlertTriangle, EyeOff } from 'lucide-react';

interface JumpscareOverlayProps {
  activeScare: JumpscareEvent | null;
  reducedTerror: boolean;
}

export const JumpscareOverlay: React.FC<JumpscareOverlayProps> = ({
  activeScare,
  reducedTerror,
}) => {
  const [imgError, setImgError] = React.useState(false);

  React.useEffect(() => {
    setImgError(false);
  }, [activeScare?.id]);

  if (!activeScare) return null;

  if (reducedTerror) {
    return (
      <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-red-950/60 backdrop-blur-xs transition-opacity duration-150">
        <div className="bg-[#0F141F] border border-red-500/60 px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 max-w-md">
          <EyeOff className="w-7 h-7 text-red-400 shrink-0" />
          <div>
            <p className="text-xs text-red-300 font-mono-tabular">
              Psychological Anomaly · Reduced Terror Mode
            </p>
            <h3 className="text-lg font-display font-bold text-slate-100">
              {activeScare.title}
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">{activeScare.subtitle}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none overflow-hidden flex items-center justify-center bg-black/95 animate-jumpscare"
      role="alert"
      aria-live="assertive"
    >
      {/* High-contrast strobe & vignette */}
      <div className="absolute inset-0 bg-radial from-transparent via-red-950/50 to-black z-10" />

      {/* Main generated horror image with zero-broken-image fallback */}
      {!imgError ? (
        <img
          src={activeScare.imageUrl}
          alt={activeScare.title}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover scale-110 contrast-150 brightness-110 saturate-150 mix-blend-screen"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-red-950 via-black to-slate-950 p-8 text-center">
          <AlertTriangle className="w-28 h-28 text-red-500 animate-ping mb-6" />
        </div>
      )}

      {/* Glitching VHS scanline bars & terrifying flash text */}
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-between py-12 px-6 select-none">
        <div className="w-full max-w-3xl flex items-center justify-between text-xs font-mono-tabular text-red-400/90 border-b border-red-500/40 pb-2">
          <span>OPTIC FEED CORRUPTED</span>
          <span>·</span>
          <span>HEART RATE SPIKE DETECTED</span>
        </div>

        <div className="text-center bg-black/75 px-8 py-5 border-y-2 border-red-600/80 shadow-2xl">
          <h2 className="text-3xl md:text-5xl font-display font-bold text-red-500 tracking-wider drop-shadow-[0_2px_18px_rgba(239,68,68,0.95)]">
            {activeScare.title}
          </h2>
          <p className="text-sm md:text-base text-slate-200 mt-2 font-medium tracking-wide">
            {activeScare.subtitle}
          </p>
        </div>

        <div className="w-full max-w-3xl flex items-center justify-between text-xs font-mono-tabular text-amber-400/90 border-t border-red-500/40 pt-2">
          <span>KEEP MOVING</span>
          <span>·</span>
          <span>DO NOT LOOK BACK</span>
        </div>
      </div>
    </div>
  );
};
