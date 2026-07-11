'use client'

import { useMemo, useState } from 'react'
import {
  Fuel,
  MapPin,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Activity,
  Layers,
  Zap,
  TrendingUp,
  BarChart3,
  History,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import {
  useStations,
  useCoverage,
  useStats,
  useRefresh,
  useSettings,
  useStationHistory,
  useAnalytics,
  type Station,
  type CoveragePoint,
} from '@/lib/hooks'
import { Toaster } from '@/components/ui/sonner'

function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function fmtRelative(iso: string | null) {
  if (!iso) return 'никогда'
  const d = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - d)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const day = Math.floor(hr / 24)
  return `${day} дн назад`
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-md bg-muted p-1.5 text-muted-foreground">{icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground truncate leading-tight">{label}</p>
            <p className="text-xl font-semibold tabular-nums leading-tight">{value}</p>
            {hint ? <p className="text-[10px] text-muted-foreground truncate leading-tight">{hint}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Вычислить тренд по типу топлива между предыдущим и текущим снапшотом.
 * Возвращает: 'up' | 'down' | 'stable' | 'new' | null
 *   up     — запас вырос (Δ > 0)
 *   down   — запас упал (Δ < 0)
 *   stable — без изменений (Δ = 0)
 *   new    — топлива не было, теперь появилось
 *   null   — недостаточно данных для сравнения
 */
function computeTrend(
  current: { fuel: string; liters: number | null } | undefined,
  previous: { fuel: string; liters: number | null } | undefined,
): { direction: 'up' | 'down' | 'stable' | 'new'; delta: number } | null {
  if (!current) return null
  if (current.liters == null) return null
  if (!previous) return { direction: 'new', delta: current.liters }
  const prevFuel = previous.fuels?.find((f) => f.fuel === current.fuel)
  if (!prevFuel || prevFuel.liters == null) return { direction: 'new', delta: current.liters }
  const delta = current.liters - prevFuel.liters
  if (delta > 0) return { direction: 'up', delta }
  if (delta < 0) return { direction: 'down', delta }
  return { direction: 'stable', delta: 0 }
}

function TrendIcon({ trend }: { trend: { direction: string; delta: number } | null }) {
  if (!trend) return null
  const size = 'w-3 h-3'
  if (trend.direction === 'up') {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400" title={`+${trend.delta.toLocaleString('ru-RU')} л`}>
        <ArrowUp className={size} />
        <span className="text-[10px] tabular-nums">+{trend.delta.toLocaleString('ru-RU')}</span>
      </span>
    )
  }
  if (trend.direction === 'down') {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400" title={`${trend.delta.toLocaleString('ru-RU')} л`}>
        <ArrowDown className={size} />
        <span className="text-[10px] tabular-nums">{trend.delta.toLocaleString('ru-RU')}</span>
      </span>
    )
  }
  if (trend.direction === 'stable') {
    return (
      <span className="inline-flex items-center text-muted-foreground" title="Без изменений">
        <Minus className={size} />
      </span>
    )
  }
  // new
  return (
    <span className="inline-flex items-center text-blue-600 dark:text-blue-400" title="Новое топливо">
      <ArrowUp className={size} />
    </span>
  )
}

/**
 * Определить состояние АЗС для отображения.
 * 3 состояния:
 *  - 'active'   — АЗС работает и сообщает об остатках (availability_fuel=true)
 *  - 'empty'    — АЗС работает, но топлива нет (все литры = 0) или данные устарели
 *  - 'nodata'   — АЗС не сообщает данные (availability_fuel=false, remaining_fuel=[])
 */
function getStationState(s: Station): 'active' | 'empty' | 'nodata' {
  if (s.availabilityFuel) return 'active'
  // availability_fuel=false, но есть remaining_fuel (возможно все нули) — топлива нет
  const fuels = s.latestSnapshot?.parsedFuels?.fuels || []
  if (fuels.length > 0) return 'empty'
  return 'nodata'
}

function StationCard({ s, onShowHistory }: { s: Station; onShowHistory?: (s: Station) => void }) {
  const state = getStationState(s)
  const fuels = s.latestSnapshot?.parsedFuels?.fuels || []
  const comment = s.latestSnapshot?.parsedFuels?.comment
  const commentDate = s.latestSnapshot?.parsedFuels?.commentDate
  const fuelDelivery = s.fuelDelivery || s.latestSnapshot?.parsedFuels?.fuelDelivery
  const prevFuels = s.previousSnapshot?.parsedFuels?.fuels

  // Цветовая индикация по 3 состояниям
  const cardClass = {
    active: 'border-emerald-500/60 bg-emerald-50/40 dark:bg-emerald-950/10',
    empty: 'border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/10',
    nodata: 'border-muted bg-muted/20 dark:bg-muted/10 opacity-75',
  }[state]

  const dotClass = {
    active: 'bg-emerald-500',
    empty: 'bg-amber-500',
    nodata: 'bg-muted-foreground/40',
  }[state]

  const stateLabel = {
    active: 'Работает',
    empty: 'Нет топлива',
    nodata: 'Нет данных',
  }[state]

  return (
    <Card className={`overflow-hidden transition-all hover:shadow-md ${cardClass}`}>
      {/* Шапка: логотип + название + статус + время */}
      <div className="p-3 pb-2 flex items-start gap-2">
        {s.logoUrl ? (
          <img
            src={s.logoUrl}
            alt={s.brand}
            className="w-8 h-8 object-contain shrink-0 rounded border bg-white p-0.5"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
            <Fuel className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight truncate">
            {s.brand || 'Без бренда'}
          </p>
          <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{s.address || '—'}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className={`w-2 h-2 rounded-full mb-1 ml-auto ${dotClass}`} title={stateLabel} />
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {s.latestSnapshot ? fmtRelative(s.latestSnapshot.sourceUpdatedAt || s.latestSnapshot.fetchedAt) : '—'}
          </p>
        </div>
      </div>

      {/* Значок подвоза — заметный, если fuel_delivery=true */}
      {fuelDelivery ? (
        <div className="mx-3 mb-2 px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-800 flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-700 dark:text-blue-300 shrink-0">
            <path d="M5 18H3c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v11"/>
            <path d="M14 9h4l4 4v4c0 .6-.4 1-1 1h-2"/>
            <circle cx="7" cy="18" r="2"/>
            <path d="M15 18H9"/>
            <circle cx="17" cy="18" r="2"/>
          </svg>
          <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
            Ожидается подвоз
          </span>
        </div>
      ) : null}

      {/* Топливо: компактные чипы с трендами + количеством машин */}
      <div className="px-3 pb-2">
        {fuels.length > 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            {fuels.map((f, i) => {
              const trend = computeTrend(
                { fuel: f.fuel, liters: f.liters },
                { fuel: f.fuel, liters: prevFuels?.find((pf) => pf.fuel === f.fuel)?.liters ?? null },
              )
              const isOut = f.liters === 0
              return (
                <div
                  key={i}
                  className={`rounded px-2 py-1.5 text-center border ${
                    isOut
                      ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
                      : 'bg-background border-border'
                  }`}
                >
                  <p className="text-[10px] text-muted-foreground leading-none">{fmtFuelName(f.fuel)}</p>
                  <p className={`text-sm font-semibold tabular-nums leading-tight mt-0.5 ${isOut ? 'text-red-600 dark:text-red-400' : ''}`}>
                    {f.liters != null ? f.liters.toLocaleString('ru-RU') : '—'}
                  </p>
                  {f.cars != null ? (
                    <p className="text-[9px] text-muted-foreground tabular-nums leading-tight mt-0.5">
                      {f.cars} маш.
                    </p>
                  ) : (
                    <div className="h-3 flex items-center justify-center">
                      <TrendIcon trend={trend} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic text-center py-2">
            Нет данных об остатках
          </p>
        )}

        {/* Комментарий — заметный, с временем */}
        {comment ? (
          <div className="mt-2 p-2 rounded bg-amber-100 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800">
            <div className="flex items-start gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700 dark:text-amber-300 shrink-0 mt-0.5">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-amber-900 dark:text-amber-100 leading-snug">
                  {comment}
                </p>
                {commentDate ? (
                  <p className="text-[9px] text-amber-700 dark:text-amber-400 mt-0.5 tabular-nums">
                    {fmtRelative(commentDate)}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Компактная кнопка истории */}
      {onShowHistory && fuels.length > 0 ? (
        <button
          onClick={() => onShowHistory(s)}
          className="w-full text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 py-1.5 border-t transition-colors flex items-center justify-center gap-1"
        >
          <History className="w-3 h-3" />
          История
        </button>
      ) : null}
    </Card>
  )
}

// Цвета для графиков — палитра из 8 цветов, циклически
const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

function fmtChartTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtLiters(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M л`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K л`
  return `${Math.round(n)} л`
}

/**
 * Человеческое название типа топлива.
 * Числовые коды (92, 95, 100) → «АИ-92», «АИ-95».
 * Строковые коды (ДТ, ДТ-З, ГАЗ) → как есть.
 */
function fmtFuelName(code: string): string {
  if (/^\d{2,3}$/.test(code)) return `АИ-${code}`
  return code
}

function StationHistoryDialog({ station, onClose }: { station: Station | null; onClose: () => void }) {
  const [hours, setHours] = useState(24)
  const { history, loading, error } = useStationHistory(station?.id ?? null, hours)

  // Трансформируем точки в формат для recharts: [{ time: "10:00", "92": 5000, "95": 17000 }, ...]
  const chartData = useMemo(() => {
    if (!history) return []
    return history.points.map((p) => ({
      time: fmtChartTime(p.fetchedAt),
      ...Object.fromEntries(
        history.fuelTypes.map((ft) => [ft, p.fuels[ft] ?? null]),
      ),
    }))
  }, [history])

  return (
    <Dialog open={!!station} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <History className="w-5 h-5" />
            <span>{station?.brand || 'Без бренда'}</span>
            {station ? (
              <span className="text-sm text-muted-foreground font-normal truncate">
                · {station.address}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            История остатков топлива по этой АЗС. Данные собираются автоматически каждые 10 минут.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pb-2">
          <span className="text-sm text-muted-foreground">Период:</span>
          {[
            { v: 6, label: '6 часов' },
            { v: 24, label: '24 часа' },
            { v: 72, label: '3 дня' },
            { v: 168, label: '7 дней' },
          ].map((opt) => (
            <Button
              key={opt.v}
              variant={hours === opt.v ? 'default' : 'outline'}
              size="sm"
              onClick={() => setHours(opt.v)}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-red-600">{error}</div>
          ) : !history || history.points.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Нет исторических данных за выбранный период.</p>
              <p className="text-sm mt-1">
                Возможно, АЗС только что добавлена или опрос ещё не запускался.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <span className="text-muted-foreground">Снапшотов за период: </span>
                <span className="font-semibold tabular-nums">{history.totalSnapshots}</span>
                <span className="text-muted-foreground"> · Первая точка: </span>
                <span className="font-medium tabular-nums">
                  {history.points[0] ? fmtChartTime(history.points[0].fetchedAt) : '—'}
                </span>
                <span className="text-muted-foreground"> · Последняя: </span>
                <span className="font-medium tabular-nums">
                  {history.points[history.points.length - 1]
                    ? fmtChartTime(history.points[history.points.length - 1].fetchedAt)
                    : '—'}
                </span>
              </div>

              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtLiters} width={70} />
                    <Tooltip
                      formatter={(v: number) => fmtLiters(v)}
                      labelStyle={{ fontSize: 12 }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {history.fuelTypes.map((ft, i) => (
                      <Line
                        key={ft}
                        type="monotone"
                        dataKey={ft}
                        name={fmtFuelName(ft)}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AnalyticsPanel() {
  const [hours, setHours] = useState(24)
  const { analytics, loading, error } = useAnalytics(hours)

  const chartData = useMemo(() => {
    if (!analytics) return []
    return analytics.points.map((p) => ({
      time: fmtChartTime(p.fetchedAt),
      ...Object.fromEntries(
        analytics.fuelTypes.map((ft) => [ft, p.totalsByFuel[ft] ?? 0]),
      ),
      activeStations: p.activeStations,
      totalStations: p.totalStations,
    }))
  }, [analytics])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Аналитика по городу
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Суммарные остатки по каждому типу топлива во времени. Источник — все опрошенные АЗС.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[
              { v: 6, label: '6ч' },
              { v: 24, label: '24ч' },
              { v: 72, label: '3д' },
              { v: 168, label: '7д' },
            ].map((opt) => (
              <Button
                key={opt.v}
                variant={hours === opt.v ? 'default' : 'outline'}
                size="sm"
                onClick={() => setHours(opt.v)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="p-4 text-sm text-red-600">{error}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="p-8 flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : !analytics || analytics.points.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Недостаточно данных для построения графиков.</p>
            <p className="text-sm mt-1">
              Нужно хотя бы 2 опроса. Подождите 10-20 минут или нажмите «Обновить данные» в шапке.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<Fuel className="w-5 h-5" />}
              label="Всего АЗС"
              value={analytics.totalStations}
              hint={`работает: ${analytics.totalActiveStations}`}
            />
            <StatCard
              icon={<Activity className="w-5 h-5" />}
              label="Снапшотов"
              value={analytics.totalSnapshots}
              hint={`за ${hours} ч`}
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="Типов топлива"
              value={analytics.fuelTypes.length}
              hint={analytics.fuelTypes.map((t) => fmtFuelName(t)).join(', ')}
            />
            <StatCard
              icon={<Layers className="w-5 h-5" />}
              label="Брендов"
              value={analytics.brandBreakdown.length}
              hint={`группировка: ${analytics.bucketSize}`}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Суммарные остатки по типам топлива</CardTitle>
              <CardDescription>
                Литраж по всем АЗС в каждый момент опроса. Рост = станции дозаправляются подвозом, спад = топливо раскупают.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <defs>
                      {analytics.fuelTypes.map((ft, i) => (
                        <linearGradient key={ft} id={`grad-${ft}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.6} />
                          <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.05} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtLiters} width={70} />
                    <Tooltip
                      formatter={(v: number) => fmtLiters(v)}
                      labelStyle={{ fontSize: 12 }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {analytics.fuelTypes.map((ft, i) => (
                      <Area
                        key={ft}
                        type="monotone"
                        dataKey={ft}
                        name={fmtFuelName(ft)}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        fill={`url(#grad-${ft})`}
                        connectNulls
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Работающие АЗС во времени</CardTitle>
              <CardDescription>
                Сколько АЗС имели статус «Работает» в каждый момент опроса.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} width={40} allowDecimals={false} />
                    <Tooltip
                      labelStyle={{ fontSize: 12 }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="stepAfter"
                      dataKey="activeStations"
                      name="Работает"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="totalStations"
                      name="Всего"
                      stroke="#6b7280"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Распределение по брендам</CardTitle>
              <CardDescription>Сколько АЗС каждого бренда обнаружено на геопортале.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {analytics.brandBreakdown.map((b) => (
                  <Badge key={b.brand} variant="outline" className="gap-1 px-3 py-1 text-sm">
                    {b.brand || 'Без бренда'}
                    <span className="text-muted-foreground tabular-nums">{b.count}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function StationsPanel() {
  const { stations, loading, error, reload } = useStations()
  const { stats } = useStats()
  const { refreshing, refresh } = useRefresh()
  const [brandFilter, setBrandFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [historyStation, setHistoryStation] = useState<Station | null>(null)

  const brands = useMemo(() => {
    const set = new Set<string>()
    stations.forEach((s) => set.add(s.brand))
    return Array.from(set).sort()
  }, [stations])

  const filtered = useMemo(() => {
    return stations.filter((s) => {
      if (brandFilter !== 'all' && s.brand !== brandFilter) return false
      if (statusFilter === 'active' && s.status !== 'Да') return false
      if (statusFilter === 'inactive' && s.status === 'Да') return false
      if (search) {
        const q = search.toLowerCase()
        if (!s.brand.toLowerCase().includes(q) && !s.address.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [stations, brandFilter, statusFilter, search])

  const handleRefresh = async () => {
    const t = toast.loading('Опрос геопортала…')
    try {
      const r = await refresh()
      await reload()
      toast.success(
        `Готово: ${r.stationsFound} АЗС найдено, +${r.stationsNew} новых, обновлено ${r.stationsUpdated}`,
        { id: t, description: r.errors.length ? `${r.errors.length} ошибок` : undefined },
      )
      if (r.errors.length) {
        r.errors.slice(0, 3).forEach((e) => toast.error(e))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: t })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            placeholder="Поиск по бренду или адресу…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Все бренды" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все бренды ({stats?.brands.reduce((a, b) => a + b.count, 0) ?? stations.length})</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="active">Только работающие</SelectItem>
                <SelectItem value="inactive">Только неработающие</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleRefresh} disabled={refreshing} size="sm" className="shrink-0 h-8">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Опрос…' : 'Обновить'}
          </Button>
        </div>

      {error ? (
        <Card>
          <CardContent className="p-3 text-sm text-red-600">{error}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-4 bg-muted rounded animate-pulse mb-3" />
                <div className="h-3 bg-muted rounded animate-pulse mb-2 w-2/3" />
                <div className="h-20 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Fuel className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Станции не найдены.</p>
            <p className="text-sm mt-1">
              Нажмите «Обновить» — система опросит геопортал и заполнит список.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filtered.map((s) => (
            <StationCard key={s.id} s={s} onShowHistory={setHistoryStation} />
          ))}
        </div>
      )}

      <StationHistoryDialog station={historyStation} onClose={() => setHistoryStation(null)} />
    </div>
  )
}

function CoveragePanel() {
  const { points, loading, error, create, update, remove } = useCoverage()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', mapX: '', mapY: '', scale: '156093.8619923378' })

  const handleCreate = async () => {
    const mapX = parseFloat(form.mapX)
    const mapY = parseFloat(form.mapY)
    const scale = parseFloat(form.scale) || 156093.8619923378
    if (!form.name.trim() || Number.isNaN(mapX) || Number.isNaN(mapY)) {
      toast.error('Заполните название и корректные координаты mapX/mapY')
      return
    }
    try {
      await create({ name: form.name.trim(), mapX, mapY, scale })
      toast.success(`Точка «${form.name}» добавлена`)
      setForm({ name: '', mapX: '', mapY: '', scale: '156093.8619923378' })
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Coverage-точки</p>
            <p className="text-sm text-muted-foreground mt-1">
              Координаты центров областей опроса геопортала. Несколько точек покрывают весь город.
              Добавляйте новые точки для масштабирования на новые районы или область.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Добавить
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая coverage-точка</DialogTitle>
                <DialogDescription>
                  Координаты в Web Mercator (EPSG:3857) в метрах. Можно взять из исходного скрипта или
                  получить из широты/доли через стандартные формулы.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="cp-name">Название</Label>
                  <Input
                    id="cp-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Например: Заречье, Октябрьский"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="cp-x">mapX (метры)</Label>
                    <Input
                      id="cp-x"
                      value={form.mapX}
                      onChange={(e) => setForm({ ...form, mapX: e.target.value })}
                      placeholder="8227460.13"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cp-y">mapY (метры)</Label>
                    <Input
                      id="cp-y"
                      value={form.mapY}
                      onChange={(e) => setForm({ ...form, mapY: e.target.value })}
                      placeholder="4431792.66"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cp-scale">scale</Label>
                  <Input
                    id="cp-scale"
                    value={form.scale}
                    onChange={(e) => setForm({ ...form, scale: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Отмена
                </Button>
                <Button onClick={handleCreate}>Создать</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="p-4 text-sm text-red-600">{error}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="p-6">
            <div className="h-20 bg-muted rounded animate-pulse" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Точки покрытия ({points.length})</CardTitle>
            <CardDescription>
              Активных: {points.filter((p) => p.enabled).length}. Каждая точка — отдельный запрос к геопорталу.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {points.map((p) => (
                <CoverageRow
                  key={p.id}
                  p={p}
                  onToggle={(enabled) => update(p.id, { enabled })}
                  onDelete={() => {
                    if (confirm(`Удалить точку «${p.name}»?`)) {
                      remove(p.id)
                        .then(() => toast.success('Удалено'))
                        .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
                    }
                  }}
                />
              ))}
              {points.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-4 text-center">
                  Точек нет. Добавьте первую.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function CoverageRow({
  p,
  onToggle,
  onDelete,
}: {
  p: CoveragePoint
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-md border bg-card hover:bg-accent/50 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{p.name}</p>
        <p className="text-xs text-muted-foreground font-mono tabular-nums truncate">
          X: {p.mapX.toFixed(2)} · Y: {p.mapY.toFixed(2)} · scale: {p.scale.toFixed(0)}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <Switch checked={p.enabled} onCheckedChange={onToggle} />
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {p.enabled ? 'вкл' : 'выкл'}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-red-600 hover:text-red-700">
          Удалить
        </Button>
      </div>
    </div>
  )
}

function SettingsPanel() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <SettingsIcon className="w-4 h-4" />
            Источник данных
          </CardTitle>
          <CardDescription>
            Дашборд получает данные из публичного API{' '}
            <a
              href="https://platforma35.ru/communal_economy/azs/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              platforma35.ru/communal_economy/azs
            </a>
            . Авторизация не требуется.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium mb-2">Что предоставляет API:</p>
            <ul className="space-y-1 text-muted-foreground text-sm">
              <li>✓ Все 9 АЗС Вологды одним запросом</li>
              <li>✓ Координаты (широта/долгота) каждой АЗС</li>
              <li>✓ Логотипы брендов (Лукойл, Газпромнефть)</li>
              <li>✓ Структурированные остатки по типам топлива (АИ-92, АИ-95, АИ-100)</li>
              <li>✓ История за день (несколько точек)</li>
              <li>✓ Комментарии о подвозе</li>
            </ul>
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium mb-1">Endpoint:</p>
            <code className="text-xs break-all">
              GET https://platforma35.ru/communal_economy/azs/api/markers/
            </code>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-300 mb-1">
              Частота обновления
            </p>
            <p className="text-amber-700 dark:text-amber-400">
              Platforma35 обновляет данные примерно каждые 2-3 часа.
              Cron дашборда опрашивает API каждые 10 минут — даже если новые данные
              появляются редко, мы их подхватываем сразу.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Расписание cron</CardTitle>
          <CardDescription>
            Автоматические задачи, запускаемые на сервере.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-start gap-3 p-2 rounded border bg-muted/30">
            <Badge variant="outline" className="shrink-0 font-mono">*/5 * * * *</Badge>
            <div>
              <p className="font-medium">Heartbeat — проверка источника</p>
              <p className="text-xs text-muted-foreground">
                Лёгкий запрос к platforma35. Обновляет статус «жив/недоступен» в дашборде.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded border bg-muted/30">
            <Badge variant="outline" className="shrink-0 font-mono">*/10 * * * *</Badge>
            <div>
              <p className="font-medium">Полный опрос АЗС</p>
              <p className="text-xs text-muted-foreground">
                Забирает все 9 АЗС + историю, сохраняет снапшоты в БД.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-2 rounded border bg-muted/30">
            <Badge variant="outline" className="shrink-0 font-mono">0 3 * * *</Badge>
            <div>
              <p className="font-medium">Бэкап БД</p>
              <p className="text-xs text-muted-foreground">
                Ежедневный бэкап SQLite в /var/backups/vologda-azs/, хранение 14 дней.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function HomePage() {
  const { stats, reload: reloadStats } = useStats()
  const { refresh } = useRefresh()

  // авто-обновление статы каждые 60 сек
  useMemo(() => {
    const t = setInterval(() => reloadStats(), 60_000)
    return () => clearInterval(t)
  }, [reloadStats])

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Toaster richColors position="top-right" />
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="rounded-md bg-emerald-600 text-white p-1.5 shrink-0">
              <Fuel className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold truncate leading-tight">АЗС Вологда — топливо</h1>
              <p className="text-[10px] text-muted-foreground truncate leading-tight">
                обновлено {fmtRelative(stats?.lastRefreshAt ?? null)}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const t = toast.loading('Опрос…')
              try {
                const r = await refresh()
                await reloadStats()
                toast.success(
                  `Готово: ${r.stationsFound} АЗС, +${r.stationsNew} новых`,
                  { id: t },
                )
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e), { id: t })
              }
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Обновить данные</span>
            <span className="sm:hidden">Обновить</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-4 py-3 sm:py-4 space-y-3">
        {stats && stats.cookieStatus === 'alive' ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 text-xs">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>
              Источник: <strong>platforma35.ru</strong>
              <span className="text-emerald-600/80 dark:text-emerald-400/80 ml-2">
                · опрос: {fmtRelative(stats.lastRefreshAt)}
              </span>
            </span>
          </div>
        ) : null}

        {stats && stats.cookieStatus === 'expired' ? (
          <Card className="border-red-500 bg-red-50 dark:bg-red-950/30">
            <CardContent className="p-4 flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-red-100 dark:bg-red-900 p-2 text-red-600 dark:text-red-300">
                <Activity className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-red-700 dark:text-red-300">
                  Источник данных временно недоступен
                </p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  Не удалось получить данные с platforma35.ru. Возможные причины: нет интернета,
                  сайт platforma35 недоступен, либо изменился формат ответа.
                </p>
                <p className="text-xs text-red-500 dark:text-red-400 mt-2">
                  Последняя успешная проверка: {fmtRelative(stats.cookieStatusAt)}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard
            icon={<Fuel className="w-4 h-4" />}
            label="Всего АЗС"
            value={stats?.totalStations ?? '—'}
            hint="в Вологде"
          />
          <StatCard
            icon={<Zap className="w-4 h-4" />}
            label="С топливом"
            value={stats?.activeStations ?? '—'}
            hint={`из ${stats?.totalStations ?? 0}`}
          />
          <StatCard
            icon={<History className="w-4 h-4" />}
            label="Снапшотов"
            value={stats?.totalSnapshots ?? '—'}
            hint="история в БД"
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label="Последний опрос"
            value={fmtRelative(stats?.lastRefreshAt ?? null)}
            hint={stats?.cookieStatus === 'alive' ? 'источник: platforma35' : 'источник недоступен'}
          />
        </div>

        <Tabs defaultValue="stations" className="w-full">
          <TabsList className="w-full sm:w-auto grid grid-cols-3 sm:flex">
            <TabsTrigger value="stations">АЗС</TabsTrigger>
            <TabsTrigger value="analytics">Аналитика</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
          </TabsList>
          <TabsContent value="stations" className="mt-3">
            <StationsPanel />
          </TabsContent>
          <TabsContent value="analytics" className="mt-3">
            <AnalyticsPanel />
          </TabsContent>
          <TabsContent value="settings" className="mt-3">
            <SettingsPanel />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t mt-auto bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 text-xs text-muted-foreground flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1">
          <p>
            Дашборд мониторинга АЗС · данные{' '}
            <a
              href="https://3d-geoportal.vologda-city.ru/portal/gasstation"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              3d-geoportal.vologda-city.ru
            </a>
          </p>
          <p>Next.js + Prisma + SQLite · фундамент для масштабирования</p>
        </div>
      </footer>
    </div>
  )
}
