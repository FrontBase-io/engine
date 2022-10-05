// This is a helper feature that allows for loops that are guaranteed to go in order and only move on once the loop is finished.
const asyncMap = async (array, loopAction) => {
 let index = 0
 await array.reduce(async (prev, curr) => {
  await prev
  await loopAction(curr, index)
  index++
  return curr
 }, array[0])
}

export default asyncMap
