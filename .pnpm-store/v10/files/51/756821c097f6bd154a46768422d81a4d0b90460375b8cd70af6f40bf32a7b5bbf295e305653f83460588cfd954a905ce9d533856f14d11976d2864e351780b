import uri, {
  type URIComponent,
} from '..'
import { expect } from 'tstyche'

const parsed = uri.parse('foo')
expect(parsed).type.toBe<URIComponent>()

const parsed2 = uri.parse('foo', {
  domainHost: true,
  scheme: 'https',
  unicodeSupport: false
})

expect(parsed2).type.toBe<URIComponent>()
