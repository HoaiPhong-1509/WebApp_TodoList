import React from 'react'
import { Button } from './ui/button';
import { Bell, UserCircle2 } from 'lucide-react';

export const Header = ({ appName = 'Task Management App', userName, onLogout, notificationCount = 0, workspaceName = 'Primary Workspace' }) => {
  return <div className='space-y-3'>

    <div className='flex flex-col gap-3 rounded-2xl bg-transparent p-4 md:flex-row md:items-center md:justify-between'>
      <div className='space-y-1'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-800'>
          {workspaceName}
        </p>
        <h1 className='text-2xl font-black text-violet-900 sm:text-[2rem]'>
          {appName}
        </h1>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <div className='inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-700'>
          <UserCircle2 className='size-4 text-slate-500' />
          <span className='font-medium'>{userName}</span>
        </div>

        <div className='inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-700'>
          <Bell className='size-4 text-primary' />
          <span>{notificationCount} notifications</span>
        </div>

        <Button variant='outline' size='sm' className='border-violet-200 bg-white hover:bg-violet-50' onClick={onLogout}>Logout</Button>
      </div>
    </div>

  </div>
}

export default Header