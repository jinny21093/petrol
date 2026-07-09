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
import { Separator } from '@/components/ui/separator'
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
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm text-muted-foreground truncate">{label}</p>
            <p className="text-2xl sm:text-3xl font-semibold mt-1 tabular-nums">{value}</p>
            {hint ? <p className="text-xs text-muted-foreground mt-1 truncate">{hint}</p> : null}
          </div>
          <div className="shrink-0 rounded-lg bg-muted p-2 sm:p-2.5 text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function StationCard({ s, onShowHistory }: { s: Station; onShowHistory?: (s: Station) => void }) {
  const isActive = s.status === 'Да'
  const fuels = s.latestSnapshot?.parsedFuels?.fuels || []
  const comment = s.latestSnapshot?.parsedFuels?.comment
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <span className="truncate">{s.brand || 'Без бренда'}</span>
              <Badge variant={isActive ? 'default' : 'secondary'} className="shrink-0">
                {isActive ? 'Работает' : 'Не работает'}
              </Badge>
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5 mt-1 text-sm">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{s.address || 'адрес не указан'}</span>
            </CardDescription>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">обновлено</p>
            <p className="text-xs font-medium tabular-nums">
              {s.latestSnapshot ? fmtRelative(s.latestSnapshot.sourceUpdatedAt || s.latestSnapshot.fetchedAt) : '—'}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {fuels.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {fuels.map((f, i) => (
              <div
                key={i}
                className="rounded-md border bg-muted/40 px-3 py-2"
              >
                <p className="text-xs text-muted-foreground">{fmtFuelName(f.fuel)}</p>
                <p className="text-base font-semibold tabular-nums">
                  {f.liters != null ? `${f.liters.toLocaleString('ru-RU')} л` : '—'}
                </p>
                {f.cars != null ? (
                  <p className="text-xs text-muted-foreground tabular-nums">{f.cars} машин</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">Нет данных об остатках</p>
        )}

        {comment ? (
          <p className="text-xs text-muted-foreground mt-3 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
            {comment}
          </p>
        ) : null}

        {s.latestSnapshot?.rawDetails && !comment && fuels.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-3 whitespace-pre-wrap font-mono bg-muted/40 p-2 rounded">
            {s.latestSnapshot.rawDetails}
          </p>
        ) : null}

        {onShowHistory ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full"
            onClick={() => onShowHistory(s)}
          >
            <History className="w-4 h-4 mr-2" />
            История остатков
          </Button>
        ) : null}
      </CardContent>
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
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Поиск по бренду или адресу…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:col-span-1"
            />
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger>
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
              <SelectTrigger>
                <SelectValue placeholder="Все статусы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="active">Только работающие</SelectItem>
                <SelectItem value="inactive">Только неработающие</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleRefresh} disabled={refreshing} className="shrink-0">
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Опрос…' : 'Обновить'}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="p-4 text-sm text-red-600">{error}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
  const { settings, loading, save } = useSettings()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  // синхронизируем локальное поле с тем, что пришло с бэка
  const lastSeen = settings.jsessionId || ''
  const [lastSeenLocal, setLastSeenLocal] = useState('')
  if (lastSeen !== lastSeenLocal) {
    setLastSeenLocal(lastSeen)
    setValue('')
  }

  const handleSave = async () => {
    if (!value.trim()) {
      toast.error('Введите JSESSIONID')
      return
    }
    setSaving(true)
    try {
      await save(value.trim())
      toast.success('JSESSIONID сохранён')
      setValue('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <SettingsIcon className="w-4 h-4" />
          Настройки сессии
        </CardTitle>
        <CardDescription>
          JSESSIONID нужен для доступа к геопорталу Вологды. Берётся из cookies браузера после
          открытия{' '}
          <a
            href="https://3d-geoportal.vologda-city.ru/portal/gasstation"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            страницы газовой карты
          </a>
          . Если поле пустое, система попытается получить свежую куку автоматически.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1.5">
          <Label htmlFor="jsess">Текущий JSESSIONID</Label>
          <div className="font-mono text-sm bg-muted px-3 py-2 rounded tabular-nums">
            {loading ? 'загрузка…' : settings.jsessionId || 'не задан'}
          </div>
        </div>
        <Separator />
        <div className="grid gap-1.5">
          <Label htmlFor="jsess-new">Новый JSESSIONID</Label>
          <Input
            id="jsess-new"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="8552CED5A2E1526B7A8F7ABF843BFD86"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Вставьте только значение куки (без префикса «JSESSIONID=»).
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </CardContent>
    </Card>
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-emerald-600 text-white p-2 shrink-0">
              <Fuel className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold truncate">АЗС Вологда — топливо</h1>
              <p className="text-xs text-muted-foreground truncate">
                Источник: 3d-geoportal.vologda-city.ru · обновлено{' '}
                {fmtRelative(stats?.lastRefreshAt ?? null)}
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

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<Fuel className="w-5 h-5" />}
            label="Всего АЗС"
            value={stats?.totalStations ?? '—'}
            hint="обнаружено на геопортале"
          />
          <StatCard
            icon={<Zap className="w-5 h-5" />}
            label="Работает сейчас"
            value={stats?.activeStations ?? '—'}
            hint={`из ${stats?.totalStations ?? 0} известных`}
          />
          <StatCard
            icon={<Layers className="w-5 h-5" />}
            label="Coverage-точек"
            value={stats?.enabledPoints ?? '—'}
            hint={`из ${stats?.totalPoints ?? 0} настроенных`}
          />
          <StatCard
            icon={<Activity className="w-5 h-5" />}
            label="Снапшотов в БД"
            value={stats?.totalSnapshots ?? '—'}
            hint="история остатков"
          />
        </div>

        {stats && stats.brands.length > 0 ? (
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground mr-1">Бренды:</span>
                {stats.brands.map((b) => (
                  <Badge key={b.brand} variant="outline" className="gap-1">
                    {b.brand || 'Без бренда'}
                    <span className="text-muted-foreground tabular-nums">{b.count}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Tabs defaultValue="stations" className="w-full">
          <TabsList className="w-full sm:w-auto grid grid-cols-4 sm:flex">
            <TabsTrigger value="stations">АЗС</TabsTrigger>
            <TabsTrigger value="analytics">Аналитика</TabsTrigger>
            <TabsTrigger value="coverage">Coverage-точки</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
          </TabsList>
          <TabsContent value="stations" className="mt-4">
            <StationsPanel />
          </TabsContent>
          <TabsContent value="analytics" className="mt-4">
            <AnalyticsPanel />
          </TabsContent>
          <TabsContent value="coverage" className="mt-4">
            <CoveragePanel />
          </TabsContent>
          <TabsContent value="settings" className="mt-4">
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
