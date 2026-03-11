import React from 'react'
import { Card } from './ui/card'
import { Circle } from 'lucide-react'

const TaskEmptyState = ({filter}) => {
  return (
    <Card
      className='p-8 text-center border-0 bg-gradient-card shadow-custom-md'
    >
      <div className='space-y-3'>
        <Circle className='mx-auto size-12 text-muted-foreground'/>
        <div>

          <h3 className='font-mdium text-foreground'>
            {
              filter === 'active' ?
              "No active tasks" :
              filter === 'completed' ?
              "No completed tasks" :
              "No tasks found"
            }
          </h3>

          <p className='text-sm text-muted-foreground'>
            {filter === 'all' ? "Add the first task to get started" : 
            `Try changing the filter or add a new task ${filter === 'active' ? "to see it here" : 
            filter === 'completed' ? "and mark it as completed to see it here" : ""}`}
            
          </p>

        </div>
      </div>
    </Card>
  )
}

export default TaskEmptyState