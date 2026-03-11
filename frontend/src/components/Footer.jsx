import React from 'react'

const Footer = ({completedTasksCount = 0, activeTasksCount = 0}) => {
  return <>
    {completedTasksCount + activeTasksCount > 0 && (
      <div className='text-center'>
        <p className='text-sm text-muted-foreground'>
          {
            completedTasksCount > 0 && (
              <>
                Great! You have completed {completedTasksCount} task{completedTasksCount > 1 ? 's' : ''}
                {
                  activeTasksCount > 0 && `, ${activeTasksCount} pending`
                }
              </>
            )
          }

          {completedTasksCount === 0 && activeTasksCount > 0 && (
            <>
              Let's start with {activeTasksCount} pending task{activeTasksCount > 1 ? 's' : ''}
            </>
          )}
        </p>
      </div>
    )}
  </>
}

export default Footer