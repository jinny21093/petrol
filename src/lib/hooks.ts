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
  parsedFuels: { comment: string | null; fuels: StationFuel[] }
  sourceCreatedAt: string | null
  sourceUpdatedAt: string | null
  fetchedAt: string
}

export interface Station {
  id: string
  externalId: number
  graphId: number | null
  brand: string
  address: string
  status: string
  hidden: boolean
  updatedAt: string
  latestSnapshot: StationSnapshot | null
}

export interface CoveragePoint {
  id: string
  name: string
  mapX: number
  mapY: number
  scale: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface Stats {
  totalStations: number
  activeStations: number
  hiddenStations: number
  totalPoints: number
  enabledPoints: number
  totalSnapshots: number
  lastRefreshAt: string | null
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

export function useCoverage() {
  const [points, setPoints] = useState<CoveragePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await jfetch<{ points: CoveragePoint[]; total: number }>('/api/coverage')
      setPoints(data.points)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(
    async (p: { name: string; mapX: number; mapY: number; scale?: number }) => {
      await jfetch('/api/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      })
      await reload()
    },
    [reload],
  )

  const update = useCallback(
    async (id: string, p: Partial<CoveragePoint>) => {
      await jfetch(`/api/coverage/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      })
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      await jfetch(`/api/coverage/${id}`, { method: 'DELETE' })
      await reload()
    },
    [reload],
  )

  return { points, loading, error, reload, create, update, remove }
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

export function useSettings() {
  const [settings, setSettings] = useState<{ jsessionId?: string }>({})
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await jfetch<{ settings: Record<string, string> }>('/api/settings')
      setSettings({ jsessionId: r.settings.jsessionId })
    } catch {
      setSettings({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const save = useCallback(
    async (jsessionId: string) => {
      await jfetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsessionId }),
      })
      await reload()
    },
    [reload],
  )

  return { settings, loading, reload, save }
}
