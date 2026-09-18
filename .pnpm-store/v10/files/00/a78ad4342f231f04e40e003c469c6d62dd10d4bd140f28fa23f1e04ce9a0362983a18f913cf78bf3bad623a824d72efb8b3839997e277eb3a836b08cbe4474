import { Bench } from 'tinybench'
import { fastUri } from '../index.js'

const { serialize, normalize, parse } = fastUri

const asciiPath = '/users/profile/settings/account'
const asciiPathWithSpaces = '/users/john doe/profile page'
const cjkPath = '/ユーザー/プロフィール/設定'
const mixedPath = '/users/日本/profile-📱-emoji/設定'
const emojiPath = '/🚀/🌍/🎉/end'
const longAsciiPath = '/' + 'a/b/c/d/e/f/g/h/'.repeat(20)
const longUtf8Path = '/' + '日本/中文/한국/'.repeat(20)

const bench = new Bench({ name: 'encoder bench', time: 1000 })

bench.add('serialize ascii path', () => {
  serialize({ scheme: 'http', host: 'example.com', path: asciiPath })
})

bench.add('serialize ascii path with spaces', () => {
  serialize({ scheme: 'http', host: 'example.com', path: asciiPathWithSpaces })
})

bench.add('serialize cjk path', () => {
  serialize({ scheme: 'http', host: 'example.com', path: cjkPath })
})

bench.add('serialize mixed path', () => {
  serialize({ scheme: 'http', host: 'example.com', path: mixedPath })
})

bench.add('serialize emoji path', () => {
  serialize({ scheme: 'http', host: 'example.com', path: emojiPath })
})

bench.add('serialize long ascii path', () => {
  serialize({ scheme: 'http', host: 'example.com', path: longAsciiPath })
})

bench.add('serialize long utf8 path', () => {
  serialize({ scheme: 'http', host: 'example.com', path: longUtf8Path })
})

bench.add('normalize utf8 uri', () => {
  normalize('http://example.com/日本/profile')
})

bench.add('parse utf8 uri', () => {
  parse('http://example.com/日本/profile')
})

await bench.run()
console.log(bench.name)
console.table(bench.table())
