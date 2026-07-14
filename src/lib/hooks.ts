'use client'

import { useEffect, useState, useCallback } from 'react'

export interface StationFuel {
  fuel: string
  liters: number | null
  cars: number | null
}

export interface StationSnapshot {
  id: string
  rawDetails: string
  parsedFuels: {
    comment: string | null
    commentDate: string | null
    fuelDelivery: boolean
    fuels: StationFuel[]
  }
  sourceCreatedAt: string | null
  sourceUpdatedAt: string | null
  fetchedAt: string
}

export interface Station {
  id: string
  externalId: number
  brand: string
  address: string
  status: string
  hidden: boolean
  source: string
  longitude: number | null
  latitude: number | null
  logoUrl: string | null
  availabilityFuel: boolean
  fuelDelivery: boolean
  updatedAt: string
  latestSnapshot: StationSnapshot | null
  previousSnapshot: StationSnapshot | null
}

export interface Stats {
  totalStations: number
  activeStations: number
  hiddenStations: number
  totalSnapshots: number
  lastRefreshAt: string | null
  sourceStatus: 'alive' | 'expired' | 'unknown'
  sourceStatusAt: string | null
  brands: { brand: string; count: number }[]
}

export interface RefreshResult {
  pointsProcessed: number
  stationsFound: number
  stationsNew: number
  stationsUpdated: number
  errors: string[]
  startedAt: string
  finishedAt: string
  sourceStatus: 'alive' | 'expired' | 'unknown'
}

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `HTTP ${r.status}`)
  }
  return (await r.json()) as T
}

export function useStations() {
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await jfetch<{ stations: Station[]; total: number }>('/api/stations')
      setStations(data.stations)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { stations, loading, error, reload }
}

export function useStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const s = await jfetch<Stats>('/api/stats')
      setStats(s)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { stats, loading, reload }
}

export function useRefresh() {
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async (): Promise<RefreshResult> => {
    setRefreshing(true)
    try {
      const r = await jfetch<RefreshResult>('/api/refresh', { method: 'POST' })
      return r
    } finally {
      setRefreshing(false)
    }
  }, [])

  return { refreshing, refresh }
}

export interface StationHistoryPoint {
  fetchedAt: string
  sourceUpdatedAt: string | null
  fuels: Record<string, number | null>
}

export interface StationHistory {
  station: { id: string; brand: string; address: string; status: string }
  fuelTypes: string[]
  points: StationHistoryPoint[]
  totalSnapshots: number
  hoursRequested: number
}

export function useStationHistory(stationId: string | null, hours = 24) {
  const [history, setHistory] = useState<StationHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!stationId) {
      setHistory(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await jfetch<StationHistory>(
        `/api/stations/${encodeURIComponent(stationId)}/history?hours=${hours}`,
      )
      setHistory(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setHistory(null)
    } finally {
      setLoading(false)
    }
  }, [stationId, hours])

  useEffect(() => {
    reload()
  }, [reload])

  return { history, loading, error, reload }
}

export interface AnalyticsPoint {
  fetchedAt: string
  totalsByFuel: Record<string, number>
  activeStations: number
  totalStations: number
}

export interface Analytics {
  fuelTypes: string[]
  points: AnalyticsPoint[]
  brandBreakdown: { brand: string; count: number }[]
  totalStations: number
  totalActiveStations: number
  totalSnapshots: number
  hoursRequested: number
  bucketSize: string
}

export function useAnalytics(hours = 24) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await jfetch<Analytics>(`/api/analytics?hours=${hours}`)
      setAnalytics(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setAnalytics(null)
    } finally {
      setLoading(false)
    }
  }, [hours])

  useEffect(() => {
    reload()
  }, [reload])

  return { analytics, loading, error, reload }
}

export interface VersionInfo {
  name: string
  current: string
  latest: string | null
  status: 'ok' | 'minor' | 'major' | 'unknown'
}

export function useVersions() {
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [appVersion, setAppVersion] = useState('?')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await jfetch<{ versions: VersionInfo[]; appVersion: string }>('/api/versions')
      setVersions(r.versions)
      setAppVersion(r.appVersion)
    } catch {
      // молча игнорируем — версии не критичны
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Загружаем только при первом раскрытии
    if (expanded && versions.length === 0) {
      reload()
    }
  }, [expanded, versions.length, reload])

  return { versions, appVersion, loading, expanded, setExpanded, reload }
}
