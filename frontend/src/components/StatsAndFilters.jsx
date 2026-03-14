import { Badge } from './ui/badge';
import React from 'react';
import { FilterType } from '@/lib/data';
import { Button } from './ui/button';
import { Filter } from 'lucide-react';

const StatsAndFilters = ({completedTasksCount = 0, activeTasksCount = 0, filter = 'all', setFilter}) => {
  return (
    <div className='flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between'>

      {/* Thống kê */}
      <div className='flex gap-3'>
        <Badge
          variant='secondary'
          className='bg-white/50 text-accent-foreground border-info/20'
        >
          {activeTasksCount} {FilterType.active}
        </Badge>
        <Badge
          variant='secondary'
          className='bg-white/50 text-accent-foreground border-success/20'
        >
          {completedTasksCount} {FilterType.completed}
        </Badge>
      </div>

      {/* Bộ lọc */}
      <div className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
        {
          Object.keys(FilterType).map((type) => (
            <Button
              key={type}
              variant={filter === type ? 'gradient' : 'ghost'}
              size='sm'
              className='capitalize'
              onClick={() => setFilter(type)}
            >
              <Filter className = 'size-4' />
              {FilterType[type]}
            </Button>
          ))
        }
      </div>

    </div>
  )
}

export default StatsAndFilters