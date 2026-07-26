Feature: Annotation queues

  Review only happens if somebody is told what to review. Left to themselves,
  reviewers re-read the traces they have already seen, two people label the
  same conversation while a hundred others go untouched, and nobody can say
  how much of the backlog is done. Annotation queues turn review into a work
  list: a trace is sent to a named person or to a shared queue, it sits there
  as pending until somebody marks it done, and the counts beside each queue
  say how much is left. Reviewers get a single place to work through — one
  conversation at a time, next, next, next — instead of hunting for what to
  look at. Queues can be filled by hand from a trace or from a bulk selection,
  or automatically by an automation that routes matching traces to reviewers
  as they arrive.

  Background:
    Given a project with traces
    And a reviewer with access to the project

  Rule: Traces are sent to the people who should review them

    Scenario: A trace is sent for review from the trace itself
      Given a reviewer reading a trace
      When they send it to one or more colleagues or queues
      Then the trace appears as pending work for each of them
      And the sender is told it was added, with a link to the queues

    Scenario: Many traces are sent for review at once
      Given a reviewer who has selected several traces in the message list
      When they send the selection to a colleague or a queue
      Then every selected trace appears as pending work there

    Scenario: Nothing is sent until a recipient is chosen
      Given a reviewer about to send a trace for review
      When no colleague or queue has been picked
      Then the send affordance is unavailable

    Scenario: Recipients can be people or queues
      Given a reviewer choosing who should review a trace
      Then they can pick individual members of the organisation
      And they can pick any of the project's queues
      And they can create a new queue without leaving the flow

    Scenario: Sending a trace that is already queued does not duplicate it
      Given a trace already sitting in a queue as pending
      When it is sent to that same queue again
      Then it still appears once

    Scenario: Re-sending a finished trace puts it back on the work list
      Given a trace in a queue that a reviewer has already marked done
      When it is sent to that queue again
      Then it becomes pending again

    Scenario: Sending for review needs more than read access
      Given a reviewer whose access to the project is read-only
      When they open a trace
      Then no affordance to send it for review is offered

  Rule: An automation can fill a queue as matching traces arrive

    Scenario: Matching traces are routed to the configured reviewers
      Given an automation configured to add matched traces to a queue
      When a trace matches it
      Then that trace appears as pending work for each configured reviewer or queue
      And it is attributed to the person who set the automation up

    Scenario: An automation must name at least one reviewer
      Given someone configuring an automation that adds traces to a queue
      When they save without choosing anybody to review
      Then the automation is not saved
      And they are told at least one annotator is required

    Scenario: Automated queueing is not held back for a digest
      Given an automation that adds matched traces to a queue
      When traces match in quick succession
      Then each one is queued as it matches rather than being batched into a digest

  Rule: Reviewers see what is waiting for them

    Scenario: The sidebar shows where work is waiting
      Given a reviewer with pending work
      When they open the annotations area
      Then they see an inbox, their own list, an all-annotations view, and every queue they belong to

    Scenario: Counts show only where something is outstanding
      Given a reviewer whose inbox has pending items and one of whose queues has none
      When they look at the sidebar
      Then the inbox carries the number of items still pending
      And the empty queue carries no number

    Scenario: The inbox gathers everything the reviewer could pick up
      Given a reviewer who has items assigned to them personally and belongs to a shared queue
      When they open the inbox
      Then it lists both their personal items and the queue's items

    Scenario: The personal list holds only what was assigned to the reviewer
      Given a reviewer who has items assigned to them personally and belongs to a shared queue
      When they open their own list
      Then it lists only the items assigned to them personally

    Scenario: Only queues the reviewer belongs to are listed
      Given a project with a queue the reviewer is not a member of
      When they open the annotations area
      Then that queue is not listed in their sidebar

    Scenario: A queue's page names who is on it
      Given a reviewer opening one of their queues
      Then the queue's name is shown
      And each of its members is shown

    Scenario: A reviewer narrows the list by state
      Given a reviewer looking at a queue
      When they switch the status filter between pending, completed, and all
      Then only items in that state are listed

    Scenario: Long lists are paged
      Given a queue with more items than fit on a page
      When a reviewer works through the pages
      Then each page shows the next batch and the total is shown

    Scenario: An empty inbox explains how to fill it
      Given a reviewer with no pending work
      When they open the inbox
      Then they are told the inbox is empty and how to send messages to a queue

  Rule: Reviewers work through a queue one trace at a time

    Scenario: Opening a pending item starts the review flow
      Given a reviewer looking at their pending work
      When they open one of the items
      Then the trace's conversation is shown for review
      And their position in the run is shown as a count of the items left to do

    Scenario: A reviewer moves between the traces in the run
      Given a reviewer part-way through a run of pending items
      When they move to the next or previous trace
      Then that trace's conversation is shown

    Scenario: The run stops at its ends
      Given a reviewer on the first item of a run
      Then they cannot move to a previous one
      And on the last item they cannot move to a next one

    Scenario: Marking an item done moves the reviewer along
      Given a reviewer reviewing a pending item with more items after it
      When they mark it done
      Then it stops counting as pending
      And the next trace is shown for review

    Scenario: Finishing the last item returns the reviewer to their queue
      Given a reviewer reviewing the last pending item in the run
      When they mark it done
      Then they are returned to their queue

    Scenario: An emptied work list is celebrated
      Given a reviewer who has marked every pending item done
      When they open the review flow
      Then they are told all tasks are complete

    Scenario: An item cannot be marked done twice
      Given an item that has already been marked done
      When a reviewer views it in the review flow
      Then the done affordance is unavailable

    Scenario: Opening a finished item just shows the trace
      Given a reviewer looking at a list containing a completed item
      When they open it
      Then the trace opens for reading rather than for review

  Rule: Queues are set up and maintained by the people who run the project

    Scenario: An operator creates a queue
      Given an operator in the annotations area
      When they create a queue with participants, a name, a description, and score types
      Then the queue is created
      And it appears in the sidebar of every participant

    Scenario: A queue without participants or score types is rejected
      Given an operator creating a queue
      When they save without choosing a participant, or without choosing a score type
      Then the queue is not created
      And they are told to pick at least one of each

    Scenario: The queue's short name is shown while it is named
      Given an operator typing a name for a new queue
      Then the short name the queue will be reachable by is shown alongside it

    Scenario: Names reserved by the annotations area are refused
      Given an operator creating a queue
      When they name it so that it would collide with the built-in inbox, personal, or review views
      Then the queue is not created
      And they are told the name is reserved

    Scenario: Two queues in a project cannot share a name
      Given a project that already has a queue by that name
      When an operator creates another one with the same name
      Then the queue is not created
      And they are told one already exists

    Scenario: An operator edits an existing queue
      Given an operator viewing one of their queues
      When they edit it and save new participants and score types
      Then the queue's participants and score types are replaced with what they chose

    Scenario: A score metric can be created while setting up a queue
      Given an operator choosing score types for a queue
      When they choose to add a new one
      Then they can define it there and then
      And it becomes selectable for the queue without losing what they had filled in

    Scenario: A reviewer without management rights cannot create queues
      Given a reviewer who may annotate but not manage the project
      When they open the annotations area
      Then no affordance to create a queue is offered
