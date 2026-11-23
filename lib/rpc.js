import { Rpc } from '@opencode/plugin/rpc'

const AnyObject = { type: 'object', additionalProperties: true }
const Empty = { type: 'object', properties: {}, additionalProperties: false }

/**
 * Contract between the server part and the Desktop settings page.
 * Keep the id and method names in sync with lib/gui.cjs.
 */
export const Weibo = Rpc.define({
  id: 'foxy-weibo',
  methods: {
    status: {
      input: Empty,
      output: AnyObject,
    },
    models: {
      input: Empty,
      output: AnyObject,
    },
    friends: {
      input: Empty,
      output: AnyObject,
    },
    update: {
      input: {
        type: 'object',
        properties: { patch: AnyObject },
        required: ['patch'],
        additionalProperties: false,
      },
      output: AnyObject,
    },
    loginStart: {
      input: Empty,
      output: AnyObject,
    },
    loginPoll: {
      input: {
        type: 'object',
        properties: { qrid: { type: 'string' } },
        required: ['qrid'],
        additionalProperties: false,
      },
      output: AnyObject,
    },
    logout: {
      input: Empty,
      output: AnyObject,
    },
    run: {
      input: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          cid: { type: 'string' },
          postId: { type: 'string' },
        },
        additionalProperties: false,
      },
      output: AnyObject,
    },
  },
  events: {},
})
