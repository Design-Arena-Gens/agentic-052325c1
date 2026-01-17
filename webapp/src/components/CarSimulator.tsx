'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ControlKey = 'throttle' | 'brake' | 'left' | 'right' | 'reverse';

type CarState = {
  x: number;
  y: number;
  velocity: number;
  heading: number;
  steering: number;
};

type Telemetry = {
  speed: number;
  headingDeg: number;
  acceleration: number;
};

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 480;
const MAX_SPEED = 22;
const MAX_REVERSE_SPEED = -6;
const ACCELERATION = 8;
const BRAKE_FORCE = 14;
const ROLLING_RESISTANCE = 2;
const TURN_RATE = Math.PI;
const STEERING_SMOOTHING = 4;
const PUBLISH_INTERVAL = 120;

const KEY_MAP: Record<string, ControlKey> = {
  ArrowUp: 'throttle',
  KeyW: 'throttle',
  ArrowDown: 'brake',
  KeyS: 'reverse',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyX: 'brake',
};

const INITIAL_STATE: CarState = {
  x: CANVAS_WIDTH / 2,
  y: CANVAS_HEIGHT / 2,
  velocity: 0,
  heading: -Math.PI / 2,
  steering: 0,
};

export function CarSimulator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const renderFrameRef = useRef<((timestamp: number) => void) | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const lastPublishRef = useRef<number>(0);
  const carStateRef = useRef<CarState>({ ...INITIAL_STATE });
  const controlsRef = useRef<Record<ControlKey, boolean>>({
    throttle: false,
    brake: false,
    left: false,
    right: false,
    reverse: false,
  });
  const [telemetry, setTelemetry] = useState<Telemetry>({
    speed: 0,
    headingDeg: 0,
    acceleration: 0,
  });

  const applyControl = useCallback((control: ControlKey, active: boolean) => {
    controlsRef.current[control] = active;
  }, []);

  const resetSimulation = useCallback(() => {
    carStateRef.current = { ...INITIAL_STATE };
    lastFrameRef.current = null;
    setTelemetry({
      speed: 0,
      headingDeg: 0,
      acceleration: 0,
    });
  }, []);

  const handleKey = useCallback((event: KeyboardEvent, isDown: boolean) => {
    const controlKey = KEY_MAP[event.code];
    if (!controlKey) {
      return;
    }
    event.preventDefault();
    applyControl(controlKey, isDown);
  }, [applyControl]);

  const drawTrack = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 12]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 0);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.moveTo(0, CANVAS_HEIGHT / 2);
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const laneCount = 4;
    const innerMargin = 60;
    for (let i = 0; i < laneCount; i += 1) {
      const inset = innerMargin + i * 28;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(148, 163, 184, 0.35)' : 'rgba(59, 130, 246, 0.25)';
      ctx.lineWidth = i === laneCount - 1 ? 6 : 2;
      ctx.beginPath();
      ctx.roundRect(
        inset,
        inset,
        CANVAS_WIDTH - inset * 2,
        CANVAS_HEIGHT - inset * 2,
        180,
      );
      ctx.stroke();
    }
  }, []);

  const drawCar = useCallback((ctx: CanvasRenderingContext2D, car: CarState) => {
    const carLength = 70;
    const carWidth = 36;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);

    ctx.fillStyle = '#38bdf8';
    ctx.shadowColor = 'rgba(56, 189, 248, 0.55)';
    ctx.shadowBlur = 16;
    ctx.fillRect(-carLength / 2, -carWidth / 2, carLength, carWidth);

    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(8 - carLength / 2, -carWidth / 2, carLength - 16, carWidth);

    ctx.fillStyle = '#111827';
    ctx.shadowBlur = 0;

    const wheelWidth = 8;
    const wheelHeight = 20;
    const wheelOffset = carWidth / 2;
    const frontOffset = carLength / 2 - 10;
    const rearOffset = -carLength / 2 + 10;

    const drawWheel = (x: number, y: number, steer = 0) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(steer);
      ctx.fillRect(-wheelHeight / 2, -wheelWidth / 2, wheelHeight, wheelWidth);
      ctx.restore();
    };

    drawWheel(rearOffset, -wheelOffset + wheelWidth, 0);
    drawWheel(rearOffset, wheelOffset - wheelWidth, 0);
    drawWheel(frontOffset, -wheelOffset + wheelWidth, car.steering * 0.6);
    drawWheel(frontOffset, wheelOffset - wheelWidth, car.steering * 0.6);

    ctx.restore();
  }, []);

  const drawShadow = useCallback((ctx: CanvasRenderingContext2D, car: CarState) => {
    ctx.save();
    ctx.translate(car.x + 6, car.y + 12);
    ctx.rotate(car.heading);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.filter = 'blur(8px)';
    ctx.fillRect(-32, -12, 64, 24);
    ctx.restore();
    ctx.filter = 'none';
  }, []);

  const renderFrame = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const previousFrame = lastFrameRef.current;
    const dt = previousFrame !== null ? (timestamp - previousFrame) / 1000 : 0;
    lastFrameRef.current = timestamp;

    const controls = controlsRef.current;
    const car = { ...carStateRef.current };

    const intendedSteer = controls.left === controls.right
      ? 0
      : controls.left
        ? -1
        : 1;
    const steerDelta = intendedSteer - car.steering;
    car.steering += steerDelta * Math.min(STEERING_SMOOTHING * dt, 1);

    let acceleration = 0;

    if (controls.throttle) {
      acceleration += ACCELERATION;
    }
    if (controls.reverse) {
      acceleration -= ACCELERATION * 0.6;
    }
    if (controls.brake && car.velocity > 0) {
      acceleration -= BRAKE_FORCE;
    } else if (controls.brake) {
      acceleration -= ACCELERATION;
    }

    const resistance = ROLLING_RESISTANCE * Math.sign(car.velocity || 1);
    const friction = -resistance;
    acceleration += friction;

    car.velocity += acceleration * dt;

    if (car.velocity > MAX_SPEED) {
      car.velocity = MAX_SPEED;
    }
    if (car.velocity < MAX_REVERSE_SPEED) {
      car.velocity = MAX_REVERSE_SPEED;
    }

    if (!controls.throttle && !controls.reverse && Math.abs(car.velocity) < 0.2 && Math.abs(acceleration) < 0.5) {
      car.velocity = 0;
    }

    const turnIntensity = Math.min(Math.abs(car.velocity) / MAX_SPEED, 1);
    car.heading += car.steering * TURN_RATE * dt * turnIntensity;

    car.x += Math.cos(car.heading) * car.velocity * dt * 60;
    car.y += Math.sin(car.heading) * car.velocity * dt * 60;

    if (car.x < 24) car.x = 24;
    if (car.x > CANVAS_WIDTH - 24) car.x = CANVAS_WIDTH - 24;
    if (car.y < 24) car.y = 24;
    if (car.y > CANVAS_HEIGHT - 24) car.y = CANVAS_HEIGHT - 24;

    carStateRef.current = car;

    drawTrack(ctx);
    drawShadow(ctx, car);
    drawCar(ctx, car);

    if (timestamp - lastPublishRef.current > PUBLISH_INTERVAL) {
      lastPublishRef.current = timestamp;
      setTelemetry({
        speed: Math.abs(car.velocity) * 3.6,
        headingDeg: ((car.heading * 180) / Math.PI + 360) % 360,
        acceleration,
      });
    }

    animationRef.current = requestAnimationFrame((nextTimestamp) => {
      renderFrameRef.current?.(nextTimestamp);
    });
  }, [drawCar, drawShadow, drawTrack]);

  useEffect(() => {
    renderFrameRef.current = renderFrame;
    return () => {
      if (renderFrameRef.current === renderFrame) {
        renderFrameRef.current = null;
      }
    };
  }, [renderFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => handleKey(event, true);
    const handleKeyUp = (event: KeyboardEvent) => handleKey(event, false);
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        controlsRef.current = {
          throttle: false,
          brake: false,
          left: false,
          right: false,
          reverse: false,
        };
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    document.addEventListener('visibilitychange', handleVisibility);

    animationRef.current = requestAnimationFrame((time) => {
      renderFrameRef.current?.(time);
    });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [handleKey, renderFrame]);

  const controlButtons = useMemo(
    () => [
      { label: 'Tăng tốc', control: 'throttle', accent: 'bg-emerald-500/90' },
      { label: 'Phanh', control: 'brake', accent: 'bg-rose-500/90' },
      { label: 'Lùi', control: 'reverse', accent: 'bg-amber-500/90' },
      { label: 'Trái', control: 'left', accent: 'bg-sky-500/90' },
      { label: 'Phải', control: 'right', accent: 'bg-sky-500/90' },
    ] satisfies { label: string; control: ControlKey; accent: string }[],
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:gap-8 md:py-16">
      <section className="flex-1 rounded-3xl border border-slate-800/50 bg-slate-900/50 shadow-lg shadow-sky-900/40 backdrop-blur">
        <header className="flex items-start justify-between border-b border-white/5 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-400/70">
              Bộ mô phỏng
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white md:text-3xl">
              Điều khiển ô tô theo thời gian thực
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300/80">
              Sử dụng các phím mũi tên hoặc WASD để điều khiển. Nhấn X hoặc xuống để phanh.
            </p>
          </div>
          <button
            type="button"
            onClick={resetSimulation}
            className="rounded-full border border-white/10 bg-slate-800/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/20 hover:text-white"
          >
            Đặt lại
          </button>
        </header>
        <div className="w-full overflow-hidden rounded-3xl px-2 pb-6 pt-2 md:px-6">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="mx-auto block w-full max-w-full"
          />
        </div>
      </section>
      <aside className="flex w-full max-w-md flex-col gap-6 rounded-3xl border border-slate-800/40 bg-slate-950/40 p-6 shadow-xl shadow-cyan-900/40 backdrop-blur">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-400">
            Thông số động lực
          </h2>
          <div className="mt-4 space-y-3 rounded-2xl border border-white/5 bg-white/5 p-4">
            <TelemetryRow label="Vận tốc" value={`${telemetry.speed.toFixed(1)} km/h`} />
            <TelemetryRow label="Góc hướng" value={`${telemetry.headingDeg.toFixed(0)}°`} />
            <TelemetryRow label="Gia tốc" value={`${telemetry.acceleration.toFixed(2)} m/s²`} />
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-400">
            Bảng điều khiển
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {controlButtons.map((button) => (
              <ControlButton
                key={button.control}
                label={button.label}
                accent={button.accent}
                onChange={(active) => applyControl(button.control, active)}
              />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/5 p-4 text-xs text-slate-300/80">
          <p className="font-semibold text-slate-100">Mẹo lái thử</p>
          <ul className="mt-3 space-y-2">
            <li>• Giữ ga và đánh lái mềm để tránh trượt bánh.</li>
            <li>• Kết hợp phanh và trả lái khi cần giảm tốc gấp.</li>
            <li>• Sử dụng nút đặt lại nếu xe thoát khỏi khu vực an toàn.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

type TelemetryRowProps = {
  label: string;
  value: string;
};

function TelemetryRow({ label, value }: TelemetryRowProps) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-900/80 px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
        {label}
      </span>
      <span className="text-lg font-semibold text-sky-300">{value}</span>
    </div>
  );
}

type ControlButtonProps = {
  label: string;
  accent: string;
  onChange: (active: boolean) => void;
};

function ControlButton({ label, accent, onChange }: ControlButtonProps) {
  const [isActive, setIsActive] = useState(false);
  const pointerCount = useRef(0);
  const activate = useCallback(() => setIsActive(true), []);
  const deactivate = useCallback(() => setIsActive(false), []);

  useEffect(() => {
    onChange(isActive);
  }, [isActive, onChange]);

  const handlePointerDown = useCallback(() => {
    pointerCount.current += 1;
    activate();
  }, [activate]);

  const handlePointerUp = useCallback(() => {
    pointerCount.current = Math.max(0, pointerCount.current - 1);
    if (pointerCount.current === 0) {
      deactivate();
    }
  }, [deactivate]);

  useEffect(() => {
    const cancel = () => {
      pointerCount.current = 0;
      deactivate();
    };
    window.addEventListener('mouseup', cancel);
    window.addEventListener('touchend', cancel);
    window.addEventListener('touchcancel', cancel);
    return () => {
      window.removeEventListener('mouseup', cancel);
      window.removeEventListener('touchend', cancel);
      window.removeEventListener('touchcancel', cancel);
    };
  }, [deactivate]);

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`flex h-20 flex-col items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60 px-3 text-center text-sm font-semibold text-slate-100/90 shadow-inner shadow-black/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 hover:border-white/20 ${isActive ? `${accent} text-white shadow-lg shadow-sky-900/50` : ''}`}
    >
      {label}
    </button>
  );
}
