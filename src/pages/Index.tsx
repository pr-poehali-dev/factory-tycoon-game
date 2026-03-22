import { useState, useEffect, useRef, useCallback } from "react";

// ==================== ТИПЫ ====================
interface Dispenser {
  id: number;
  level: number;
  income: number;
  price: number;
  lastFired: number;
}

interface Building {
  id: number;
  dispensers: Dispenser[];
  maxSlots: number;
}

interface GameState {
  balance: number;
  buildings: Building[];
  chestBalance: number;
  conveyorSpeedLevel: number;
  dispenserSpeedLevel: number;
  totalEarned: number;
  nextDispenserLevel: number;
}

// ==================== КОНСТАНТЫ ====================
const MAX_BUILDINGS = 5555;
const SLOTS_PER_BUILDING = 35;
const BUILDING_PRICE = 10000;
const CONVEYOR_INTERVAL_BASE = 10000;

const CONVEYOR_SPEED_UPGRADES = [
  { level: 1, label: "Базовая", multiplier: 1.0, price: 0 },
  { level: 2, label: "Ускоренная", multiplier: 1.5, price: 500 },
  { level: 3, label: "Быстрая", multiplier: 2.0, price: 2000 },
  { level: 4, label: "Турбо", multiplier: 3.0, price: 8000 },
  { level: 5, label: "Макс", multiplier: 5.0, price: 25000 },
];

const DISPENSER_SPEED_UPGRADES = [
  { level: 1, label: "Базовая", multiplier: 1.0, price: 0 },
  { level: 2, label: "×1.5", multiplier: 1.5, price: 300 },
  { level: 3, label: "×2", multiplier: 2.0, price: 1500 },
  { level: 4, label: "×3", multiplier: 3.0, price: 6000 },
  { level: 5, label: "×5 Макс", multiplier: 5.0, price: 20000 },
];

function getDispenserPrice(level: number): number {
  return 200 + (level - 1) * 50;
}

function getDispenserIncome(level: number): number {
  return 4 + level;
}

function createDispenser(level: number): Dispenser {
  return {
    id: Date.now() + Math.random(),
    level,
    income: getDispenserIncome(level),
    price: getDispenserPrice(level),
    lastFired: Date.now(),
  };
}

const SAVE_KEY = "factory_tycoon_save";

const defaultState: GameState = {
  balance: 0,
  buildings: [
    {
      id: 1,
      dispensers: [createDispenser(1)],
      maxSlots: SLOTS_PER_BUILDING,
    },
  ],
  chestBalance: 0,
  conveyorSpeedLevel: 1,
  dispenserSpeedLevel: 1,
  totalEarned: 0,
  nextDispenserLevel: 1,
};

const MAX_OFFLINE_MS = 2 * 60 * 60 * 1000; // 2 часа

function getConveyorIntervalRaw(dispSpeedLevel: number, convSpeedLevel: number): number {
  const dMult = DISPENSER_SPEED_UPGRADES[Math.min(dispSpeedLevel - 1, 4)].multiplier;
  const cMult = CONVEYOR_SPEED_UPGRADES[Math.min(convSpeedLevel - 1, 4)].multiplier;
  return CONVEYOR_INTERVAL_BASE / (dMult * cMult);
}

function loadGame(): { state: GameState; offlineEarned: number } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { state: defaultState, offlineEarned: 0 };
    const saved = JSON.parse(raw) as GameState & { savedAt?: number };
    const now = Date.now();

    // Офлайн-заработок
    let offlineEarned = 0;
    const savedAt = saved.savedAt ?? now;
    const offlineMs = Math.min(now - savedAt, MAX_OFFLINE_MS);

    if (offlineMs > 1000) {
      const interval = getConveyorIntervalRaw(saved.dispenserSpeedLevel, saved.conveyorSpeedLevel);
      const cycles = Math.floor(offlineMs / interval);
      saved.buildings.forEach((b) => {
        b.dispensers.forEach((d) => {
          offlineEarned += d.income * cycles;
        });
      });
      saved.balance += offlineEarned;
      saved.chestBalance += offlineEarned;
      saved.totalEarned += offlineEarned;
    }

    saved.buildings = saved.buildings.map((b) => ({
      ...b,
      dispensers: b.dispensers.map((d) => ({ ...d, lastFired: now })),
    }));

    return { state: saved, offlineEarned };
  } catch (e) {
    return { state: defaultState, offlineEarned: 0 };
  }
}

function saveGame(state: GameState) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch (e) {
    console.warn("Save failed", e);
  }
}

const { state: initState, offlineEarned: initOfflineEarned } = loadGame();

// ==================== УТИЛИТЫ ====================
function formatMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}М ₽`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}К ₽`;
  return `${Math.floor(n)} ₽`;
}

function getConveyorInterval(dispSpeedLevel: number, convSpeedLevel: number): number {
  const dMult = DISPENSER_SPEED_UPGRADES[dispSpeedLevel - 1].multiplier;
  const cMult = CONVEYOR_SPEED_UPGRADES[convSpeedLevel - 1].multiplier;
  return CONVEYOR_INTERVAL_BASE / (dMult * cMult);
}

// ==================== КОМПОНЕНТ: РАЗДАТЧИК С КОНВЕЙЕРОМ ====================
const DISPENSER_COLORS = [
  "#f97316", "#3b82f6", "#22c55e", "#a855f7", "#ef4444",
  "#06b6d4", "#eab308", "#ec4899", "#14b8a6", "#f59e0b",
];

interface DispenserBoxProps {
  dispenser: Dispenser;
  conveyorSpeedLevel: number;
  dispenserSpeedLevel: number;
  index: number;
}

function DispenserBox({ dispenser, conveyorSpeedLevel, dispenserSpeedLevel, index }: DispenserBoxProps) {
  const [active, setActive] = useState(false);
  const [cubePos, setCubePos] = useState<number | null>(null);
  const color = DISPENSER_COLORS[dispenser.level % DISPENSER_COLORS.length];
  const interval = getConveyorInterval(dispenserSpeedLevel, conveyorSpeedLevel);
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const offset = (index * 1300) % interval;
    let startTime: number | null = null;
    let cubeStartTime: number | null = null;

    const fireCube = () => {
      setActive(true);
      cubeStartTime = Date.now();
      setTimeout(() => setActive(false), 400);

      const moveCube = () => {
        if (!cubeStartTime) return;
        const elapsed = Date.now() - cubeStartTime;
        const progress = Math.min(elapsed / (interval * 0.9), 1);
        setCubePos(progress);
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(moveCube);
        } else {
          setCubePos(null);
        }
      };
      rafRef.current = requestAnimationFrame(moveCube);
    };

    const schedule = () => {
      animRef.current = setTimeout(() => {
        fireCube();
        startTime = Date.now();
        const loop = () => {
          animRef.current = setTimeout(() => {
            fireCube();
            loop();
          }, interval);
        };
        loop();
      }, offset);
    };

    schedule();
    return () => {
      if (animRef.current) clearTimeout(animRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [interval, index]);

  const gearDuration = Math.max(0.5, 4 / DISPENSER_SPEED_UPGRADES[dispenserSpeedLevel - 1].multiplier);
  const beltDuration = Math.max(0.3, 3 / CONVEYOR_SPEED_UPGRADES[conveyorSpeedLevel - 1].multiplier);

  return (
    <div className="flex flex-col items-center gap-0.5" style={{ width: 50 }}>
      {/* Корпус раздатчика */}
      <div
        className="relative rounded flex flex-col items-center justify-center transition-all duration-200"
        style={{
          width: 44,
          height: 40,
          background: active
            ? `linear-gradient(160deg, ${color}22, ${color}10)`
            : "linear-gradient(160deg, #1e2030, #161824)",
          border: `1.5px solid ${active ? color : "#2a2d40"}`,
          boxShadow: active ? `0 0 14px ${color}55, inset 0 0 8px ${color}22` : "inset 0 0 4px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            fontSize: 18,
            display: "inline-block",
            animation: `spin-gear ${gearDuration}s linear infinite`,
            color: active ? color : "#4a5068",
            filter: active ? `drop-shadow(0 0 4px ${color})` : "none",
          }}
        >
          ⚙
        </div>
        <div className="text-[7px] font-mono leading-none mt-0.5" style={{ color: color + "99" }}>
          Lv{dispenser.level}
        </div>
        <div
          className="absolute top-1 right-1 rounded-full transition-all duration-300"
          style={{
            width: 4, height: 4,
            background: active ? color : "#2a2d40",
            boxShadow: active ? `0 0 5px ${color}` : "none",
          }}
        />
      </div>

      {/* Конвейерная лента */}
      <div
        className="relative overflow-hidden"
        style={{ width: 44, height: 16, borderRadius: 3, border: "1px solid #1e2030" }}
      >
        {/* Лента */}
        <div
          className="absolute inset-0"
          style={{
            background: "repeating-linear-gradient(90deg, #12131e 0px, #12131e 18px, #1c1d2e 18px, #1c1d2e 20px, #12131e 20px, #12131e 38px, #1c1d2e 38px, #1c1d2e 40px)",
            backgroundSize: "40px 100%",
            animation: `conveyor-move ${beltDuration}s linear infinite`,
          }}
        />
        {/* Кубик */}
        {cubePos !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2"
            style={{
              left: `calc(${cubePos * 85}% + 2px)`,
              width: 12, height: 12,
              background: `linear-gradient(135deg, ${color}, ${color}88)`,
              border: `1px solid ${color}cc`,
              borderRadius: 2,
              boxShadow: `0 0 6px ${color}88`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 6,
              fontWeight: "bold",
              color: "#fff",
              fontFamily: "monospace",
            }}
          >
            {dispenser.income}
          </div>
        )}
        {/* Ролики */}
        <div className="absolute left-0.5 top-0.5 rounded-full bg-[#0f1020] border border-[#2a2d40]" style={{ width: 10, height: 10 }} />
        <div className="absolute right-0.5 top-0.5 rounded-full bg-[#0f1020] border border-[#2a2d40]" style={{ width: 10, height: 10 }} />
      </div>

      <div className="text-[7px] font-mono" style={{ color: "#4a5568" }}>
        +{dispenser.income}₽
      </div>
    </div>
  );
}

// ==================== КОМПОНЕНТ: ЗДАНИЕ ====================
interface BuildingCardProps {
  building: Building;
  conveyorSpeedLevel: number;
  dispenserSpeedLevel: number;
  isSelected: boolean;
  onClick: () => void;
}

function BuildingCard({ building, conveyorSpeedLevel, dispenserSpeedLevel, isSelected, onClick }: BuildingCardProps) {
  const filled = building.dispensers.length;
  const capacity = building.maxSlots;
  const fillPct = (filled / capacity) * 100;

  return (
    <div
      className="relative rounded cursor-pointer transition-all duration-300 p-3"
      style={{
        background: isSelected
          ? "linear-gradient(160deg, #1a1c2e, #141520)"
          : "linear-gradient(160deg, #111218, #0d0e16)",
        border: isSelected ? "1.5px solid #f59e0b" : "1.5px solid #1e2030",
        boxShadow: isSelected ? "0 0 24px rgba(245,158,11,0.12)" : "none",
        minWidth: 300,
      }}
      onClick={onClick}
    >
      {/* Заголовок */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">🏭</span>
          <span
            className="font-oswald text-xs font-semibold tracking-widest uppercase"
            style={{ color: "#f59e0b" }}
          >
            Завод #{building.id}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-gray-500">{filled}/{capacity}</span>
          <div className="w-14 h-1 bg-[#1a1c2e] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${fillPct}%`,
                background: fillPct > 80 ? "#ef4444" : fillPct > 50 ? "#f97316" : "#22c55e",
              }}
            />
          </div>
        </div>
      </div>

      {/* Раздатчики */}
      <div className="flex flex-wrap gap-1 min-h-[68px]">
        {building.dispensers.map((d, i) => (
          <DispenserBox
            key={d.id}
            dispenser={d}
            conveyorSpeedLevel={conveyorSpeedLevel}
            dispenserSpeedLevel={dispenserSpeedLevel}
            index={i}
          />
        ))}
        {Array.from({ length: Math.min(4, capacity - filled) }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="rounded flex items-center justify-center"
            style={{
              width: 44, height: 56,
              border: "1px dashed #1e2030",
              opacity: 0.5,
            }}
          >
            <span className="text-[9px] text-gray-700">+</span>
          </div>
        ))}
      </div>

      {/* Линия к сундуку */}
      <div className="mt-2 flex items-center gap-1">
        <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, #f59e0b44, transparent)" }} />
        <div
          className="text-[8px] font-mono px-1.5 py-0.5 rounded"
          style={{ color: "#f59e0b66", border: "1px solid #f59e0b22" }}
        >
          → сундук
        </div>
      </div>

      {isSelected && (
        <div
          className="absolute top-2 right-2 rounded-full"
          style={{
            width: 6, height: 6,
            background: "#f59e0b",
            boxShadow: "0 0 8px #f59e0b",
            animation: "pulse-glow 2s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}

// ==================== СУНДУК ====================
function Chest({ balance }: { balance: number }) {
  const [glow, setGlow] = useState(false);
  const prev = useRef(balance);

  useEffect(() => {
    if (balance > prev.current) {
      setGlow(true);
      setTimeout(() => setGlow(false), 600);
    }
    prev.current = balance;
  }, [balance]);

  return (
    <div
      className="flex flex-col items-center justify-center rounded p-4 transition-all duration-400"
      style={{
        background: "linear-gradient(160deg, #1a1208, #100e08)",
        border: glow ? "1.5px solid #f59e0b" : "1.5px solid #2a2010",
        boxShadow: glow ? "0 0 30px rgba(245,158,11,0.4)" : "0 0 8px rgba(0,0,0,0.6)",
        minWidth: 130,
        transition: "all 0.3s ease",
      }}
    >
      <div className="text-3xl mb-1" style={{ transform: glow ? "scale(1.12)" : "scale(1)", transition: "transform 0.2s" }}>📦</div>
      <div className="text-[9px] font-oswald tracking-widest uppercase mb-1" style={{ color: "#92600a" }}>Сундук</div>
      <div className="font-oswald font-bold text-base" style={{ color: "#f59e0b" }}>
        {formatMoney(balance)}
      </div>
    </div>
  );
}

// ==================== ГЛАВНЫЙ КОМПОНЕНТ ====================
export default function Index() {
  const [game, setGame] = useState<GameState>(initState);
  const [selectedBuildingId, setSelectedBuildingId] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<"game" | "shop" | "upgrades" | "stats">("game");
  const [notification, setNotification] = useState<string | null>(null);
  const [balanceAnim, setBalanceAnim] = useState(false);
  const gameRef = useRef(game);
  gameRef.current = game;

  const showNotif = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  }, []);

  // Уведомление об офлайн-заработке при старте
  useEffect(() => {
    if (initOfflineEarned > 0) {
      setTimeout(() => {
        showNotif(`Пока вас не было, заработано: +${formatMoney(initOfflineEarned)} 📦`);
      }, 800);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Автосохранение каждые 5 секунд
  useEffect(() => {
    const interval = setInterval(() => {
      saveGame(gameRef.current);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Сохранение при уходе со страницы
  useEffect(() => {
    const onUnload = () => saveGame(gameRef.current);
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const resetGame = useCallback(() => {
    if (!confirm("Сбросить весь прогресс? Это действие необратимо.")) return;
    localStorage.removeItem(SAVE_KEY);
    setGame(defaultState);
    setSelectedBuildingId(1);
    showNotif("Игра сброшена. Начинаем заново!");
  }, [showNotif]);

  // Игровой цикл
  useEffect(() => {
    const tick = setInterval(() => {
      const g = gameRef.current;
      const interval = getConveyorInterval(g.dispenserSpeedLevel, g.conveyorSpeedLevel);
      let earned = 0;

      g.buildings.forEach((building) => {
        building.dispensers.forEach((d) => {
          const timeSince = Date.now() - d.lastFired;
          if (timeSince >= interval) {
            earned += d.income;
            d.lastFired = Date.now();
          }
        });
      });

      if (earned > 0) {
        setGame((prev) => ({
          ...prev,
          balance: prev.balance + earned,
          chestBalance: prev.chestBalance + earned,
          totalEarned: prev.totalEarned + earned,
        }));
        setBalanceAnim(true);
        setTimeout(() => setBalanceAnim(false), 400);
      }
    }, 500);

    return () => clearInterval(tick);
  }, []);

  const buyDispenser = useCallback(() => {
    const g = gameRef.current;
    const level = g.nextDispenserLevel;
    const price = getDispenserPrice(level);
    const building = g.buildings.find((b) => b.id === selectedBuildingId);
    if (!building) { showNotif("Выберите здание!"); return; }
    if (building.dispensers.length >= building.maxSlots) { showNotif("Здание заполнено! Купите новое."); return; }
    if (g.balance < price) { showNotif(`Нужно ${formatMoney(price)}`); return; }
    setGame((prev) => ({
      ...prev,
      balance: prev.balance - price,
      nextDispenserLevel: prev.nextDispenserLevel + 1,
      buildings: prev.buildings.map((b) =>
        b.id === selectedBuildingId
          ? { ...b, dispensers: [...b.dispensers, createDispenser(level)] }
          : b
      ),
    }));
    showNotif(`Раздатчик Lv${level} установлен! +${getDispenserIncome(level)}₽/цикл`);
  }, [selectedBuildingId, showNotif]);

  const buyBuilding = useCallback(() => {
    const g = gameRef.current;
    if (g.balance < BUILDING_PRICE) { showNotif(`Нужно ${formatMoney(BUILDING_PRICE)}`); return; }
    if (g.buildings.length >= MAX_BUILDINGS) { showNotif("Максимум зданий!"); return; }
    const newId = Math.max(...g.buildings.map((b) => b.id)) + 1;
    setGame((prev) => ({
      ...prev,
      balance: prev.balance - BUILDING_PRICE,
      buildings: [...prev.buildings, { id: newId, dispensers: [], maxSlots: SLOTS_PER_BUILDING }],
    }));
    setSelectedBuildingId(newId);
    showNotif(`Завод #${newId} построен!`);
  }, [showNotif]);

  const upgradeConveyor = useCallback(() => {
    const g = gameRef.current;
    if (g.conveyorSpeedLevel >= 5) { showNotif("Конвейер на максимуме!"); return; }
    const next = CONVEYOR_SPEED_UPGRADES[g.conveyorSpeedLevel];
    if (g.balance < next.price) { showNotif(`Нужно ${formatMoney(next.price)}`); return; }
    setGame((prev) => ({ ...prev, balance: prev.balance - next.price, conveyorSpeedLevel: prev.conveyorSpeedLevel + 1 }));
    showNotif(`Конвейер: ${next.label}!`);
  }, [showNotif]);

  const upgradeDispenser = useCallback(() => {
    const g = gameRef.current;
    if (g.dispenserSpeedLevel >= 5) { showNotif("Раздатчики на максимуме!"); return; }
    const next = DISPENSER_SPEED_UPGRADES[g.dispenserSpeedLevel];
    if (g.balance < next.price) { showNotif(`Нужно ${formatMoney(next.price)}`); return; }
    setGame((prev) => ({ ...prev, balance: prev.balance - next.price, dispenserSpeedLevel: prev.dispenserSpeedLevel + 1 }));
    showNotif(`Раздатчики: ${next.label}!`);
  }, [showNotif]);

  const selectedBuilding = game.buildings.find((b) => b.id === selectedBuildingId);
  const totalDispensers = game.buildings.reduce((s, b) => s + b.dispensers.length, 0);
  const currentInterval = getConveyorInterval(game.dispenserSpeedLevel, game.conveyorSpeedLevel);
  const incomePerCycle = game.buildings.reduce((s, b) => s + b.dispensers.reduce((ss, d) => ss + d.income, 0), 0);
  const nextDispenserPrice = getDispenserPrice(game.nextDispenserLevel);
  const nextConveyorUpgrade = CONVEYOR_SPEED_UPGRADES[game.conveyorSpeedLevel] ?? null;
  const nextDispenserUpgrade = DISPENSER_SPEED_UPGRADES[game.dispenserSpeedLevel] ?? null;

  return (
    <div className="min-h-screen flex flex-col font-roboto" style={{ background: "#090a0f", color: "#c9c8c0", maxHeight: "100vh", overflow: "hidden" }}>

      {/* ШАПКА */}
      <header
        className="flex items-center justify-between px-5 py-2.5 flex-shrink-0"
        style={{ background: "#070810", borderBottom: "1px solid #1a1b25" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏭</span>
          <div>
            <div className="font-oswald text-base font-bold tracking-widest uppercase" style={{ color: "#f59e0b" }}>
              Factory Tycoon
            </div>
            <div className="text-[9px] font-mono tracking-widest" style={{ color: "#4a5068" }}>
              ПРОМЫШЛЕННАЯ ИМПЕРИЯ
            </div>
          </div>
        </div>

        {/* БАЛАНС - главное табло */}
        <div
          className="flex flex-col items-center px-8 py-2 rounded transition-all duration-300"
          style={{
            background: balanceAnim
              ? "linear-gradient(160deg, #2a1e08, #1a1208)"
              : "linear-gradient(160deg, #1a1208, #110e08)",
            border: balanceAnim ? "1.5px solid #f59e0b" : "1.5px solid #2a2010",
            boxShadow: balanceAnim ? "0 0 30px rgba(245,158,11,0.3)" : "none",
          }}
        >
          <div className="text-[9px] font-mono tracking-widest uppercase" style={{ color: "#92600a" }}>
            💰 Текущий баланс
          </div>
          <div
            className="font-oswald font-bold leading-none"
            style={{
              fontSize: 28,
              color: "#f59e0b",
              textShadow: balanceAnim ? "0 0 20px #f59e0b" : "none",
              transition: "text-shadow 0.3s",
            }}
          >
            {formatMoney(game.balance)}
          </div>
          <div className="text-[9px] font-mono" style={{ color: "#22c55e88" }}>
            +{incomePerCycle}₽ / {(currentInterval / 1000).toFixed(1)}с
          </div>
        </div>

        {/* Мини-статы */}
        <div className="flex gap-5 items-center">
          {[
            { icon: "🏭", label: "Заводов", value: game.buildings.length, color: "#3b82f6" },
            { icon: "⚙️", label: "Раздатчиков", value: totalDispensers, color: "#a855f7" },
            { icon: "📦", label: "В сундуке", value: formatMoney(game.chestBalance), color: "#f97316" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-[9px] font-mono" style={{ color: "#4a5068" }}>{s.icon} {s.label}</div>
              <div className="font-oswald font-bold text-sm" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
          <div className="text-[8px] font-mono ml-2" style={{ color: "#22c55e55" }}>💾 авто</div>
        </div>
      </header>

      {/* НАВИГАЦИЯ */}
      <nav className="flex flex-shrink-0" style={{ background: "#07080f", borderBottom: "1px solid #141520" }}>
        {[
          { key: "game", label: "🏭 ЗАВОДЫ" },
          { key: "shop", label: "🛒 МАГАЗИН" },
          { key: "upgrades", label: "⚡ УЛУЧШЕНИЯ" },
          { key: "stats", label: "📊 СТАТИСТИКА" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className="px-5 py-2.5 text-[11px] font-oswald tracking-widest transition-all duration-200"
            style={{
              borderBottom: activeTab === tab.key ? "2px solid #f59e0b" : "2px solid transparent",
              color: activeTab === tab.key ? "#f59e0b" : "#4a5068",
              background: "transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* КОНТЕНТ */}
      <div className="flex-1 overflow-hidden flex min-h-0">

        {/* ВКЛАДКА: ЗАВОДЫ */}
        {activeTab === "game" && (
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {game.buildings.map((b) => (
                <BuildingCard
                  key={b.id}
                  building={b}
                  conveyorSpeedLevel={game.conveyorSpeedLevel}
                  dispenserSpeedLevel={game.dispenserSpeedLevel}
                  isSelected={selectedBuildingId === b.id}
                  onClick={() => setSelectedBuildingId(b.id)}
                />
              ))}
              <button
                onClick={buyBuilding}
                className="w-full rounded p-4 text-center transition-all duration-200 group"
                style={{
                  background: "transparent",
                  border: "1.5px dashed #1e2030",
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = "#f59e0b44"}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = "#1e2030"}
              >
                <div className="text-xl mb-1">🏗️</div>
                <div className="font-oswald text-xs uppercase tracking-widest" style={{ color: "#4a5068" }}>
                  Построить новый завод — {formatMoney(BUILDING_PRICE)}
                </div>
              </button>
            </div>

            {/* Боковая панель сундука */}
            <div
              className="w-44 flex flex-col items-center justify-start pt-6 gap-4 flex-shrink-0 overflow-auto"
              style={{ background: "#07080f", borderLeft: "1px solid #141520" }}
            >
              <div className="text-[9px] font-mono tracking-widest uppercase" style={{ color: "#4a5068" }}>
                Главный сундук
              </div>
              <Chest balance={game.chestBalance} />

              <div className="w-full px-3 mt-2">
                <div className="text-[9px] font-mono uppercase tracking-widest mb-1 text-center" style={{ color: "#4a5068" }}>
                  Выбран: Завод #{selectedBuildingId}
                </div>
                {selectedBuilding && (
                  <div className="text-[9px] font-mono text-center mb-2" style={{ color: "#6b7280" }}>
                    {selectedBuilding.dispensers.length}/{selectedBuilding.maxSlots} слотов
                  </div>
                )}
                <button
                  onClick={buyDispenser}
                  className="w-full py-2.5 rounded text-[10px] font-oswald uppercase tracking-widest transition-all duration-200"
                  style={{
                    background: game.balance >= nextDispenserPrice
                      ? "linear-gradient(135deg, #f97316, #c2410c)"
                      : "#111218",
                    color: game.balance >= nextDispenserPrice ? "#fff" : "#2a2d40",
                    border: `1px solid ${game.balance >= nextDispenserPrice ? "#f97316" : "#1e2030"}`,
                  }}
                >
                  + Раздатчик<br />
                  <span style={{ fontSize: 8 }}>Lv{game.nextDispenserLevel} · {formatMoney(nextDispenserPrice)}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ВКЛАДКА: МАГАЗИН */}
        {activeTab === "shop" && (
          <div className="flex-1 overflow-auto p-6">
            <div style={{ maxWidth: 640, margin: "0 auto" }} className="space-y-4">
              <div className="font-oswald text-base uppercase tracking-widest mb-5" style={{ color: "#f59e0b" }}>
                🛒 Магазин оборудования
              </div>

              {/* Раздатчик */}
              <div className="rounded p-5" style={{ background: "#111218", border: "1.5px solid #1e2030" }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-oswald text-sm uppercase tracking-wider" style={{ color: "#e5e7eb" }}>
                      ⚙️ Раздатчик Уровень {game.nextDispenserLevel}
                    </div>
                    <div className="text-[11px] font-mono mt-1" style={{ color: "#6b7280" }}>
                      Доход: <span style={{ color: "#22c55e" }}>+{getDispenserIncome(game.nextDispenserLevel)}₽</span> за цикл ·{" "}
                      Цена: <span style={{ color: "#f59e0b" }}>{formatMoney(nextDispenserPrice)}</span>
                    </div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: "#4a5068" }}>
                      Завод #{selectedBuildingId} · {selectedBuilding?.dispensers.length ?? 0}/{SLOTS_PER_BUILDING} слотов
                    </div>
                  </div>
                  <button
                    onClick={buyDispenser}
                    disabled={game.balance < nextDispenserPrice}
                    className="px-4 py-2 rounded font-oswald text-xs uppercase tracking-widest disabled:opacity-30 transition-all duration-200 hover:scale-105"
                    style={{ background: "linear-gradient(135deg, #f97316, #c2410c)", color: "#fff" }}
                  >
                    Купить
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const lvl = game.nextDispenserLevel + i;
                    return (
                      <div
                        key={lvl}
                        className="flex-shrink-0 rounded p-2 text-center"
                        style={{
                          background: i === 0 ? "#1a1408" : "#0d0e16",
                          border: i === 0 ? "1px solid #f97316" : "1px solid #1e2030",
                          minWidth: 68,
                        }}
                      >
                        <div className="text-[9px] font-oswald" style={{ color: "#f59e0b" }}>Lv{lvl}</div>
                        <div className="text-[9px] font-mono" style={{ color: "#22c55e" }}>+{getDispenserIncome(lvl)}₽</div>
                        <div className="text-[9px] font-mono" style={{ color: "#6b7280" }}>{formatMoney(getDispenserPrice(lvl))}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Здание */}
              <div className="rounded p-5" style={{ background: "#111218", border: "1.5px solid #1e2030" }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-oswald text-sm uppercase tracking-wider" style={{ color: "#e5e7eb" }}>
                      🏭 Новый завод #{game.buildings.length + 1}
                    </div>
                    <div className="text-[11px] font-mono mt-1" style={{ color: "#6b7280" }}>
                      35 слотов для раздатчиков · <span style={{ color: "#f59e0b" }}>{formatMoney(BUILDING_PRICE)}</span>
                    </div>
                    <div className="text-[10px] font-mono mt-1" style={{ color: "#4a5068" }}>
                      {game.buildings.length} / {MAX_BUILDINGS} зданий
                    </div>
                    <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ width: 180, background: "#1a1c2e" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(game.buildings.length / MAX_BUILDINGS) * 100}%`, background: "#3b82f6" }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={buyBuilding}
                    disabled={game.balance < BUILDING_PRICE || game.buildings.length >= MAX_BUILDINGS}
                    className="px-4 py-2 rounded font-oswald text-xs uppercase tracking-widest disabled:opacity-30 transition-all duration-200 hover:scale-105"
                    style={{ background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", color: "#fff" }}
                  >
                    Построить
                  </button>
                </div>
              </div>

              {/* Таблица */}
              <div className="rounded p-4" style={{ background: "#09090f", border: "1px solid #141520" }}>
                <div className="font-oswald text-xs uppercase tracking-widest mb-3" style={{ color: "#4a5068" }}>
                  📈 Расчёт окупаемости
                </div>
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1e2030", color: "#4a5068" }}>
                      <th className="text-left py-1 pr-3">Уровень</th>
                      <th className="text-right py-1 pr-3">Цена</th>
                      <th className="text-right py-1 pr-3">Доход/цикл</th>
                      <th className="text-right py-1">Окупаемость</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 8 }).map((_, i) => {
                      const lvl = i + 1;
                      const price = getDispenserPrice(lvl);
                      const income = getDispenserIncome(lvl);
                      const cyclesNeeded = Math.ceil(price / income);
                      const timeNeeded = cyclesNeeded * (currentInterval / 1000);
                      return (
                        <tr key={lvl} style={{ borderBottom: "1px solid #111218" }}>
                          <td className="py-1 pr-3" style={{ color: "#f59e0b" }}>Lv{lvl}</td>
                          <td className="py-1 pr-3 text-right" style={{ color: "#c9c8c0" }}>{formatMoney(price)}</td>
                          <td className="py-1 pr-3 text-right" style={{ color: "#22c55e" }}>+{income}₽</td>
                          <td className="py-1 text-right" style={{ color: "#3b82f6" }}>
                            {timeNeeded < 60 ? `${timeNeeded.toFixed(0)}с` :
                             timeNeeded < 3600 ? `${(timeNeeded / 60).toFixed(1)}м` :
                             `${(timeNeeded / 3600).toFixed(1)}ч`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ВКЛАДКА: УЛУЧШЕНИЯ */}
        {activeTab === "upgrades" && (
          <div className="flex-1 overflow-auto p-6">
            <div style={{ maxWidth: 640, margin: "0 auto" }} className="space-y-5">
              <div className="font-oswald text-base uppercase tracking-widest mb-5" style={{ color: "#f59e0b" }}>
                ⚡ Улучшения производства
              </div>

              {/* Конвейер */}
              <div className="rounded p-5" style={{ background: "#111218", border: "1.5px solid #1e2030" }}>
                <div className="font-oswald text-sm uppercase tracking-wider mb-3" style={{ color: "#e5e7eb" }}>
                  🔄 Скорость конвейера
                </div>
                <div className="flex gap-2 mb-4">
                  {CONVEYOR_SPEED_UPGRADES.map((u) => (
                    <div
                      key={u.level}
                      className="flex-1 rounded p-2 text-center"
                      style={{
                        background: game.conveyorSpeedLevel >= u.level ? "#0f1e10" : "#0d0e16",
                        border: game.conveyorSpeedLevel === u.level
                          ? "1px solid #22c55e"
                          : game.conveyorSpeedLevel > u.level
                          ? "1px solid #14301a"
                          : "1px solid #1e2030",
                      }}
                    >
                      <div className="text-[9px] font-oswald" style={{ color: game.conveyorSpeedLevel >= u.level ? "#22c55e" : "#4a5068" }}>
                        {u.label}
                      </div>
                      <div className="text-[8px] font-mono" style={{ color: "#6b7280" }}>×{u.multiplier}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono" style={{ color: "#6b7280" }}>
                    Текущий: <span style={{ color: "#22c55e" }}>{CONVEYOR_SPEED_UPGRADES[game.conveyorSpeedLevel - 1].label}</span>
                    {nextConveyorUpgrade && (
                      <> · Следующий: <span style={{ color: "#f59e0b" }}>{nextConveyorUpgrade.label} ({formatMoney(nextConveyorUpgrade.price)})</span></>
                    )}
                  </div>
                  <button
                    onClick={upgradeConveyor}
                    disabled={!nextConveyorUpgrade || game.balance < nextConveyorUpgrade.price}
                    className="px-4 py-2 rounded font-oswald text-xs uppercase tracking-widest disabled:opacity-30 transition-all hover:scale-105"
                    style={{ background: "linear-gradient(135deg, #22c55e, #15803d)", color: "#fff" }}
                  >
                    {game.conveyorSpeedLevel >= 5 ? "Максимум" : `Улучшить · ${nextConveyorUpgrade ? formatMoney(nextConveyorUpgrade.price) : ""}`}
                  </button>
                </div>
              </div>

              {/* Раздатчики */}
              <div className="rounded p-5" style={{ background: "#111218", border: "1.5px solid #1e2030" }}>
                <div className="font-oswald text-sm uppercase tracking-wider mb-3" style={{ color: "#e5e7eb" }}>
                  ⚙️ Скорость раздатчиков
                </div>
                <div className="flex gap-2 mb-4">
                  {DISPENSER_SPEED_UPGRADES.map((u) => (
                    <div
                      key={u.level}
                      className="flex-1 rounded p-2 text-center"
                      style={{
                        background: game.dispenserSpeedLevel >= u.level ? "#160f22" : "#0d0e16",
                        border: game.dispenserSpeedLevel === u.level
                          ? "1px solid #a855f7"
                          : game.dispenserSpeedLevel > u.level
                          ? "1px solid #2a1040"
                          : "1px solid #1e2030",
                      }}
                    >
                      <div className="text-[9px] font-oswald" style={{ color: game.dispenserSpeedLevel >= u.level ? "#a855f7" : "#4a5068" }}>
                        {u.label}
                      </div>
                      <div className="text-[8px] font-mono" style={{ color: "#6b7280" }}>×{u.multiplier}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono" style={{ color: "#6b7280" }}>
                    Текущий: <span style={{ color: "#a855f7" }}>{DISPENSER_SPEED_UPGRADES[game.dispenserSpeedLevel - 1].label}</span>
                    {nextDispenserUpgrade && (
                      <> · Следующий: <span style={{ color: "#f59e0b" }}>{nextDispenserUpgrade.label} ({formatMoney(nextDispenserUpgrade.price)})</span></>
                    )}
                  </div>
                  <button
                    onClick={upgradeDispenser}
                    disabled={!nextDispenserUpgrade || game.balance < nextDispenserUpgrade.price}
                    className="px-4 py-2 rounded font-oswald text-xs uppercase tracking-widest disabled:opacity-30 transition-all hover:scale-105"
                    style={{ background: "linear-gradient(135deg, #a855f7, #6d28d9)", color: "#fff" }}
                  >
                    {game.dispenserSpeedLevel >= 5 ? "Максимум" : `Улучшить · ${nextDispenserUpgrade ? formatMoney(nextDispenserUpgrade.price) : ""}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ВКЛАДКА: СТАТИСТИКА */}
        {activeTab === "stats" && (
          <div className="flex-1 overflow-auto p-6">
            <div style={{ maxWidth: 640, margin: "0 auto" }}>
              <div className="font-oswald text-base uppercase tracking-widest mb-5" style={{ color: "#f59e0b" }}>
                📊 Статистика империи
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: "Текущий баланс", value: formatMoney(game.balance), color: "#f59e0b" },
                  { label: "Накоплено в сундуке", value: formatMoney(game.chestBalance), color: "#f97316" },
                  { label: "Всего заработано", value: formatMoney(game.totalEarned), color: "#22c55e" },
                  { label: "Количество заводов", value: String(game.buildings.length), color: "#3b82f6" },
                  { label: "Всего раздатчиков", value: String(totalDispensers), color: "#a855f7" },
                  { label: "Доход за цикл", value: `+${incomePerCycle}₽`, color: "#06b6d4" },
                  { label: "Интервал цикла", value: `${(currentInterval / 1000).toFixed(1)}с`, color: "#84cc16" },
                  { label: "Скорость конвейера", value: CONVEYOR_SPEED_UPGRADES[game.conveyorSpeedLevel - 1].label, color: "#22c55e" },
                  { label: "Скорость раздатчиков", value: DISPENSER_SPEED_UPGRADES[game.dispenserSpeedLevel - 1].label, color: "#a855f7" },
                  { label: "Следующий раздатчик", value: `Lv${game.nextDispenserLevel}`, color: "#f97316" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded p-3"
                    style={{ background: "#111218", border: "1px solid #1e2030" }}
                  >
                    <div className="text-[9px] font-mono uppercase tracking-widest mb-1" style={{ color: "#4a5068" }}>{item.label}</div>
                    <div className="font-oswald text-lg font-bold" style={{ color: item.color }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded p-4" style={{ background: "#09090f", border: "1px solid #141520" }}>
                <div className="font-oswald text-xs uppercase tracking-widest mb-3" style={{ color: "#4a5068" }}>
                  🏭 Производительность по заводам
                </div>
                <div className="space-y-2">
                  {game.buildings.map((b) => {
                    const income = b.dispensers.reduce((s, d) => s + d.income, 0);
                    return (
                      <div key={b.id} className="flex items-center gap-3">
                        <span className="text-[10px] font-oswald w-16" style={{ color: "#f59e0b" }}>Завод #{b.id}</span>
                        <span className="text-[9px] font-mono w-16" style={{ color: "#6b7280" }}>{b.dispensers.length} ед.</span>
                        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "#1a1c2e" }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(b.dispensers.length / b.maxSlots) * 100}%`,
                              background: "#f59e0b",
                            }}
                          />
                        </div>
                        <span className="text-[9px] font-mono w-12 text-right" style={{ color: "#22c55e" }}>+{income}₽</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* УВЕДОМЛЕНИЕ */}
      {notification && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded font-oswald text-xs uppercase tracking-widest z-50"
          style={{
            background: "linear-gradient(135deg, #1a1208, #0f0e0a)",
            border: "1.5px solid #f59e0b88",
            color: "#f59e0b",
            boxShadow: "0 0 30px rgba(245,158,11,0.25)",
            animation: "fadeIn 0.3s ease-out",
          }}
        >
          {notification}
        </div>
      )}

      <style>{`
        @keyframes spin-gear {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes conveyor-move {
          0% { background-position: 0 0; }
          100% { background-position: 40px 0; }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 6px rgba(245,158,11,0.4); }
          50% { box-shadow: 0 0 16px rgba(245,158,11,0.9); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}