'use client'

import React from 'react'

interface CinematicBackgroundProps {
  isRerankMode?: boolean
}

export default function CinematicBackground({ isRerankMode = true }: CinematicBackgroundProps) {
  // Deterministic floating bubbles with varied scales, drift speeds, and delays
  const bubbles = [
    { size: 75, left: '5%', delay: '0s', duration: '20s' },
    { size: 42, left: '16%', delay: '5s', duration: '16s' },
    { size: 95, left: '32%', delay: '1.5s', duration: '24s' },
    { size: 36, left: '48%', delay: '8s', duration: '14s' },
    { size: 62, left: '62%', delay: '3s', duration: '21s' },
    { size: 84, left: '78%', delay: '6.5s', duration: '19s' },
    { size: 48, left: '91%', delay: '10s', duration: '17s' },
    { size: 55, left: '24%', delay: '12s', duration: '22s' },
    { size: 70, left: '85%', delay: '14s', duration: '18s' }
  ]

  // Twinkling stars, sparkles and celestial constellations
  const sparkles = [
    { icon: '✨', top: '7%', left: '10%', delay: '0.2s', size: 'text-xl' },
    { icon: '⭐', top: '14%', left: '74%', delay: '1.6s', size: 'text-lg' },
    { icon: '🌟', top: '24%', left: '26%', delay: '0.9s', size: 'text-2xl' },
    { icon: '✨', top: '32%', left: '88%', delay: '2.3s', size: 'text-lg' },
    { icon: '💫', top: '44%', left: '14%', delay: '1.4s', size: 'text-xl' },
    { icon: '⭐', top: '56%', left: '80%', delay: '3.1s', size: 'text-lg' },
    { icon: '✨', top: '68%', left: '42%', delay: '0.6s', size: 'text-xl' },
    { icon: '🌟', top: '18%', left: '48%', delay: '2.8s', size: 'text-sm' },
    { icon: '🫧', top: '62%', left: '18%', delay: '1.9s', size: 'text-xl' },
    { icon: '🫧', top: '38%', left: '72%', delay: '3.5s', size: 'text-lg' }
  ]

  // Floating gentle fireflies / magical motes
  const fireflies = [
    { top: '30%', left: '15%', size: 5, delay: '0s' },
    { top: '45%', left: '35%', size: 4, delay: '2s' },
    { top: '25%', left: '60%', size: 6, delay: '4s' },
    { top: '55%', left: '75%', size: 5, delay: '1s' },
    { top: '38%', left: '88%', size: 4, delay: '3.5s' }
  ]

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* 1. Deep Cosmic Sky Gradient */}
      <div
        className={`absolute inset-0 transition-colors duration-1000 ${
          isRerankMode
            ? 'bg-gradient-to-b from-[#040716] via-[#091129] to-[#02040b]'
            : 'bg-gradient-to-b from-[#180b06] via-[#211009] to-[#080403]'
        }`}
      />

      {/* 2. Ambient Aurora & Nebula Ribbons */}
      <div
        className={`absolute -top-32 left-1/4 w-[850px] h-[600px] rounded-full blur-[160px] opacity-40 transition-all duration-1000 ${
          isRerankMode ? 'bg-indigo-600/40' : 'bg-amber-600/35'
        }`}
      />
      <div
        className={`absolute top-1/4 right-0 w-[700px] h-[550px] rounded-full blur-[170px] opacity-35 transition-all duration-1000 ${
          isRerankMode ? 'bg-cyan-500/35' : 'bg-rose-600/30'
        }`}
      />
      <div
        className={`absolute top-2/3 left-1/12 w-[600px] h-[450px] rounded-full blur-[150px] opacity-25 transition-all duration-1000 ${
          isRerankMode ? 'bg-purple-600/30' : 'bg-orange-600/25'
        }`}
      />

      {/* 3. Starfield Grid Constellation Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(#ffffff20_1px,transparent_1px)] [background-size:32px_32px] opacity-50 [mask-image:radial-gradient(ellipse_80%_60%_at_50%_25%,#000_65%,transparent_100%)]" />

      {/* 4. Majestic Photorealistic Glowing Moon with Floating Orbital Physics */}
      <div className="cinematic-moon-wrap top-10 right-12 sm:right-24">
        {/* Outer Lunar Corona / Halo Rings */}
        <div className="lunar-halo-ring -inset-6 w-36 h-36 sm:w-44 sm:h-44" />
        <div className="lunar-halo-ring -inset-12 w-48 h-48 sm:w-56 sm:h-56 opacity-50" style={{ animationDelay: '2s' }} />

        {/* Luminous Moon Disc */}
        <div
          className={`w-24 h-24 sm:w-32 sm:h-32 transition-all duration-1000 ${
            isRerankMode ? 'cinematic-moon' : 'cinematic-moon-amber'
          }`}
          title="Cinematic Moon"
        >
          {/* Detailed Lunar Surface Craters */}
          <div className="moon-crater-1" />
          <div className="moon-crater-2" />
          <div className="moon-crater-3" />
          <div className="moon-crater-4" />

          {/* Moonlight Core Rim Glow */}
          <div className="absolute -inset-1 rounded-full border border-white/40 blur-xs pointer-events-none" />
        </div>
      </div>

      {/* 5. Cinematic Shooting Stars / Meteors with Luminous Tails */}
      <div
        className="absolute top-[8%] right-[16%] w-44 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent animate-meteor-fast"
        style={{ animationDelay: '1.2s' }}
      />
      <div
        className="absolute top-[20%] right-[38%] w-56 h-[2.5px] bg-gradient-to-r from-transparent via-cyan-200 to-transparent animate-meteor-slow"
        style={{ animationDelay: '4.6s' }}
      />
      <div
        className="absolute top-[5%] left-[28%] w-36 h-[2px] bg-gradient-to-r from-transparent via-amber-200 to-transparent animate-meteor-fast"
        style={{ animationDelay: '7.8s' }}
      />
      <div
        className="absolute top-[32%] right-[55%] w-48 h-[2px] bg-gradient-to-r from-transparent via-indigo-200 to-transparent animate-meteor-slow"
        style={{ animationDelay: '11.4s' }}
      />

      {/* 6. Multi-Tiered Cinematic Mountain Silhouette (4-Layer Alpine Landscape) */}
      <div className="absolute inset-x-0 bottom-0 h-[48vh] max-h-[550px] w-full pointer-events-none">
        {/* Tier 1: Distant Summit Peaks (Layer 1 - Highest Alpine Ridges with Snow Highlights) */}
        <svg
          className="absolute inset-x-0 bottom-24 w-full h-full opacity-25 preserve-3d"
          viewBox="0 0 1440 380"
          fill="none"
          preserveAspectRatio="none"
        >
          <path
            d="M0,230 L140,140 L300,200 L480,90 L660,210 L840,110 L1020,180 L1200,80 L1340,160 L1440,195 L1440,380 L0,380 Z"
            fill={isRerankMode ? 'url(#mountain-grad-far-blue)' : 'url(#mountain-grad-far-amber)'}
          />
          {/* Alpine Summit Rim Highlights */}
          <path
            d="M140,140 L160,170 M480,90 L510,140 M840,110 L870,150 M1200,80 L1230,130"
            stroke={isRerankMode ? '#c7d2fe' : '#fed7aa'}
            strokeWidth="1.5"
            strokeOpacity="0.4"
          />
          <defs>
            <linearGradient id="mountain-grad-far-blue" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#0a102b" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="mountain-grad-far-amber" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#25140b" stopOpacity="0.85" />
            </linearGradient>
          </defs>
        </svg>

        {/* Tier 2: Midground Highland Crags (Layer 2 - Jagged Alpine Pass) */}
        <svg
          className="absolute inset-x-0 bottom-14 w-full h-full opacity-45"
          viewBox="0 0 1440 340"
          fill="none"
          preserveAspectRatio="none"
        >
          <path
            d="M0,270 L110,190 L260,250 L420,150 L580,230 L740,160 L900,240 L1080,140 L1260,220 L1440,170 L1440,340 L0,340 Z"
            fill={isRerankMode ? 'url(#mountain-grad-mid-blue)' : 'url(#mountain-grad-mid-amber)'}
          />
          <defs>
            <linearGradient id="mountain-grad-mid-blue" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#060a1d" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="mountain-grad-mid-amber" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#1a0d06" stopOpacity="0.95" />
            </linearGradient>
          </defs>
        </svg>

        {/* Tier 3: Near Forest & Foothill Silhouette (Layer 3 - Intricate Ridges) */}
        <svg
          className="absolute inset-x-0 bottom-6 w-full h-full opacity-70"
          viewBox="0 0 1440 300"
          fill="none"
          preserveAspectRatio="none"
        >
          <path
            d="M0,240 C120,220 220,260 360,210 C500,160 640,240 780,190 C920,140 1060,230 1200,180 C1320,140 1380,190 1440,160 L1440,300 L0,300 Z"
            fill={isRerankMode ? '#040716' : '#120703'}
          />
        </svg>

        {/* Soft Flowing Valley Mist / Cloud Inversion Layer */}
        <div className="absolute inset-x-0 bottom-16 h-32 bg-gradient-to-t from-indigo-500/15 via-white/8 to-transparent blur-2xl animate-mist" />
        <div className="absolute inset-x-0 bottom-10 h-20 bg-gradient-to-t from-cyan-400/10 via-white/5 to-transparent blur-xl animate-mist" style={{ animationDelay: '6s' }} />

        {/* Moonlight Water Reflection Shimmer Trail directly under the moon */}
        <div className="moonlight-water-reflection right-16 sm:right-28 bottom-0" />

        {/* 7. Multi-Tier Rolling Ocean Waves (4 Cascading Continuous Waves) */}
        {/* Wave 4 (Deep Ocean Swell) */}
        <div className="absolute inset-x-0 bottom-0 w-[200%] h-40 opacity-30 animate-wave-4">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="w-full h-full">
            <path
              d="M0,35 C180,85 360,5 540,40 C720,85 940,5 1200,45 L1200,120 L0,120 Z"
              fill={isRerankMode ? '#3730a3' : '#9a3412'}
            />
          </svg>
        </div>

        {/* Wave 3 (Mid-Ocean Rolling Surge) */}
        <div className="absolute inset-x-0 bottom-0 w-[200%] h-34 opacity-40 animate-wave-3">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="w-full h-full">
            <path
              d="M0,45 C150,95 350,10 500,50 C650,95 900,15 1200,55 L1200,120 L0,120 Z"
              fill={isRerankMode ? '#4338ca' : '#b45309'}
            />
          </svg>
        </div>

        {/* Wave 2 (Midground Shimmer Wave) */}
        <div className="absolute inset-x-0 bottom-0 w-[200%] h-28 opacity-50 animate-wave-2">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="w-full h-full">
            <path
              d="M0,50 C200,10 400,80 600,38 C800,0 1000,70 1200,32 L1200,120 L0,120 Z"
              fill={isRerankMode ? '#06b6d4' : '#ea580c'}
            />
          </svg>
        </div>

        {/* Wave 1 (Foreground Radiant Wave Crest) */}
        <div className="absolute inset-x-0 bottom-0 w-[200%] h-22 opacity-65 animate-wave-1">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="w-full h-full">
            <path
              d="M0,55 C300,95 500,20 700,55 C900,95 1100,25 1200,45 L1200,120 L0,120 Z"
              fill={isRerankMode ? '#0891b2' : '#d97706'}
            />
          </svg>
        </div>

        {/* Ambient bottom ocean gradient fade */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#02040b] to-transparent opacity-95" />
      </div>

      {/* 8. Cute Iridescent Glass Bubbles Drifting Through Sky & Mountains */}
      {bubbles.map((b, i) => (
        <div
          key={i}
          className="cute-bubble"
          style={{
            width: `${b.size}px`,
            height: `${b.size}px`,
            left: b.left,
            animation: `float-bubble-up ${b.duration} linear infinite`,
            animationDelay: b.delay
          }}
        />
      ))}

      {/* 9. Floating Gentle Fireflies / Golden Spark Motes */}
      {fireflies.map((f, i) => (
        <div
          key={i}
          className="glowing-firefly"
          style={{
            top: f.top,
            left: f.left,
            width: `${f.size}px`,
            height: `${f.size}px`,
            animationDelay: f.delay
          }}
        />
      ))}

      {/* 10. Twinkling Cute Sparkles & Stars */}
      {sparkles.map((s, i) => (
        <div
          key={i}
          className={`absolute ${s.size} animate-twinkle select-none drop-shadow-md`}
          style={{ top: s.top, left: s.left, animationDelay: s.delay }}
        >
          {s.icon}
        </div>
      ))}
    </div>
  )
}
