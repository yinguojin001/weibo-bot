const assert = require('node:assert/strict')

/**
 * Verify that the mutual-friend loader follows pagination to the end and
 * filters out accounts that do not follow back.
 */
async function main() {
  const { fetchMutualFriends } = await import('../lib/weibo.js')

  const pages = []
  globalThis.fetch = async (url) => {
    const page = Number(new URL(String(url)).searchParams.get('page'))
    pages.push(page)
    const data =
      page === 1
        ? {
            users: [
              { id: '1', screen_name: '互关A', following: true, follow_me: true },
              { id: '2', screen_name: '单向B', following: true, follow_me: false },
            ],
            next_cursor: 20,
          }
        : page === 2
          ? {
              users: [
                { id: '3', screen_name: '互关C', following: true, follow_me: true },
                { id: '1', screen_name: '互关A', following: true, follow_me: true },
              ],
              next_cursor: 0,
            }
          : { users: [], next_cursor: 0 }
    return new Response(JSON.stringify(data), { status: 200 })
  }

  const friends = await fetchMutualFriends({ cookie: 'SUB=x', accountUid: '9' })
  assert.deepEqual(friends.map((item) => item.uid), ['1', '3'])
  assert.deepEqual(friends.map((item) => item.name), ['互关A', '互关C'])
  assert.deepEqual(pages, [1, 2], 'all pages are visited until next_cursor is 0')

  console.log('foxy-weibo friends tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
