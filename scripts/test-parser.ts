/**
 * Тест парсера parseFuelDetails — проверяет все варианты формата,
 * которые реально приходят с геопортала Вологды.
 *
 * Запуск: bun run /home/z/my-project/scripts/test-parser.ts
 */
import { parseFuelDetails } from '../src/lib/geoportal'

interface Case {
  name: string
  input: string
  expectFuels: { fuel: string; liters: number | null; cars: number | null }[]
  expectComment: string | null
}

const cases: Case[] = [
  {
    name: 'Лукойл с литрами и машинами',
    input: 'Остаток топлива на 13:00:\n95 - 9000 л / 450 машин\n92 - 6000 л / 300 машин',
    expectFuels: [
      { fuel: '95', liters: 9000, cars: 450 },
      { fuel: '92', liters: 6000, cars: 300 },
    ],
    expectComment: null,
  },
  {
    name: 'Газпромнефть — только машины, без литров (с ДТ)',
    input: 'Остаток топлива на 13:00:\nДТ - 1066 машин\n92 - 700 машин\n95 - 400 машин',
    expectFuels: [
      { fuel: 'ДТ', liters: null, cars: 1066 },
      { fuel: '92', liters: null, cars: 700 },
      { fuel: '95', liters: null, cars: 400 },
    ],
    expectComment: null,
  },
  {
    name: 'Лукойл — только литры, без машин',
    input: 'Остаток топлива на 13:00:\n95 -  3000 л',
    expectFuels: [{ fuel: '95', liters: 3000, cars: null }],
    expectComment: null,
  },
  {
    name: 'Комментарий о подвозе',
    input:
      'Ожидается подвоз в 10:30\n95 - 11100 л / 555 машин\n92 - 6100 л / 305 машин',
    expectFuels: [
      { fuel: '95', liters: 11100, cars: 555 },
      { fuel: '92', liters: 6100, cars: 305 },
    ],
    expectComment: 'Ожидается подвоз в 10:30',
  },
  {
    name: 'Пустая строка (неработающая АЗС)',
    input: '',
    expectFuels: [],
    expectComment: null,
  },
  {
    name: 'ДТ-З — зимнее дизельное',
    input: 'Остаток топлива на 14:00:\nДТ-З - 5000 л / 250 машин\n92 - 8000 л',
    expectFuels: [
      { fuel: 'ДТ-З', liters: 5000, cars: 250 },
      { fuel: '92', liters: 8000, cars: null },
    ],
    expectComment: null,
  },
  {
    name: 'Десятичные литры через запятую',
    input: '95 - 1500,5 л / 75 машин',
    expectFuels: [{ fuel: '95', liters: 1500.5, cars: 75 }],
    expectComment: null,
  },
  {
    name: 'Только комментарий, без топлива',
    input: 'Нет топлива\nОжидается подвоз вечером',
    expectFuels: [],
    expectComment: 'Нет топлива | Ожидается подвоз вечером',
  },
]

let pass = 0
let fail = 0

for (const c of cases) {
  const result = parseFuelDetails(c.input)
  const okFuels = JSON.stringify(result.fuels) === JSON.stringify(c.expectFuels)
  const okComment = result.comment === c.expectComment
  if (okFuels && okComment) {
    pass++
    console.log(`✓ ${c.name}`)
  } else {
    fail++
    console.log(`✗ ${c.name}`)
    if (!okFuels) {
      console.log(`   fuels expected: ${JSON.stringify(c.expectFuels)}`)
      console.log(`   fuels got:      ${JSON.stringify(result.fuels)}`)
    }
    if (!okComment) {
      console.log(`   comment expected: ${JSON.stringify(c.expectComment)}`)
      console.log(`   comment got:      ${JSON.stringify(result.comment)}`)
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
