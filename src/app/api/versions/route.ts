import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * GET /api/versions
 *
 * Возвращает версии ключевых зависимостей проекта + статус (актуально/устарело).
 * Проверяет npm registry для каждой зависимости, результат кешируется 1 час.
 *
 * Используется в footer дашборда для отображения технической информации.
 */

// Кеш в памяти (сбрасывается при перезапуске процесса)
let cache: { data: VersionInfo[]; timestamp: number } | null = null
const CACHE_TTL = 60 * 60 * 1000 // 1 час

interface VersionInfo {
  name: string
  current: string
  latest: string | null
  status: 'ok' | 'minor' | 'major' | 'unknown'
}

// Только ключевые пакеты для отображения в UI
// (не все 30 — только те, что важны для технического состояния)
const TRACKED_PACKAGES = [
  'next',
  'react',
  'prisma',
  '@prisma/client',
  'recharts',
  'tailwindcss',
  'typescript',
  'lucide-react',
  'sonner',
  'eslint',
]

// Маппинг display-name → package-name
const DISPLAY_NAMES: Record<string, string> = {
  'next': 'Next.js',
  'react': 'React',
  'prisma': 'Prisma',
  '@prisma/client': 'Prisma Client',
  'recharts': 'Recharts',
  'tailwindcss': 'Tailwind CSS',
  'typescript': 'TypeScript',
  'lucide-react': 'Lucide Icons',
  'sonner': 'Sonner',
  'eslint': 'ESLint',
}

async function fetchLatestVersion(pkg: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { version?: string }
    return data.version || null
  } catch {
    return null
  }
}

function compareVersions(current: string, latest: string): 'ok' | 'minor' | 'major' {
  const curParts = current.split('.').map((p) => parseInt(p, 10) || 0)
  const latParts = latest.split('.').map((p) => parseInt(p, 10) || 0)
  if (curParts[0] !== latParts[0]) return 'major'
  if (curParts[1] !== latParts[1] || curParts[2] !== latParts[2]) return 'minor'
  return 'ok'
}

export async function GET() {
  // Проверка кеша
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json({ versions: cache.data, cached: true })
  }

  // Читаем package.json
  const pkgPath = join(process.cwd(), 'package.json')
  const pkgRaw = readFileSync(pkgPath, 'utf-8')
  const pkg = JSON.parse(pkgRaw) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    version?: string
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

  // Параллельно проверяем latest версии для отслеживаемых пакетов
  const results: VersionInfo[] = await Promise.all(
    TRACKED_PACKAGES.map(async (name) => {
      const spec = allDeps[name] || '?'
      const current = spec.replace(/^[^~^]/, '').replace(/[\^~]/, '')
      const latest = await fetchLatestVersion(name)
      const status: VersionInfo['status'] = latest
        ? compareVersions(current, latest)
        : 'unknown'
      return {
        name: DISPLAY_NAMES[name] || name,
        current,
        latest,
        status,
      }
    }),
  )

  // Сохраняем в кеш
  cache = { data: results, timestamp: Date.now() }

  return NextResponse.json({
    versions: results,
    appVersion: pkg.version || '?',
    cached: false,
  })
}
