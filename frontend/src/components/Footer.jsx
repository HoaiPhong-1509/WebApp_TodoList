import React from 'react'

const Footer = ({ completedTasksCount = 0, inProgressTasksCount = 0, todoTasksCount = 0 }) => {
  const pendingTasksCount = todoTasksCount + inProgressTasksCount;

  return <>
    {completedTasksCount + pendingTasksCount > 0 && (
      <div className='text-center'>
        <p className='text-sm text-muted-foreground'>
          {
            completedTasksCount > 0 && (
              <>
                Great! You have completed {completedTasksCount} task{completedTasksCount > 1 ? 's' : ''}
                {
                  pendingTasksCount > 0 && `, ${pendingTasksCount} pending`
                }
              </>
            )
          }

          {completedTasksCount === 0 && pendingTasksCount > 0 && (
            <>
              Let's start with {pendingTasksCount} pending task{pendingTasksCount > 1 ? 's' : ''}
            </>
          )}
        </p>
      </div>
    )}
  </>
}

export default Footer