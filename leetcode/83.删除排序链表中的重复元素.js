/*
 * @lc app=leetcode.cn id=83 lang=javascript
 *
 * [83] 删除排序链表中的重复元素
 */

// @lc code=start
/**
 * Definition for singly-linked list.
 * function ListNode(val, next) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.next = (next===undefined ? null : next)
 * }
 */
/**
 * @param {ListNode} head
 * @return {ListNode}
 */
var deleteDuplicates = function(head) {
  if(!head) return head
  let slow = head
  let fast = head.next

  while(slow && fast) {
    if (slow.val  === fast.val) {
      slow.next = fast.next
      fast = fast.next
    } else {
      slow = fast
      fast = fast.next
    }
  }

  return head

};
// @lc code=end

