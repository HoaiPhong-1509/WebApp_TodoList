import React from 'react'
import { Button } from './ui/button';
import { Bell, UserCircle2 } from 'lucide-react';

export const Header = ({ appName = 'Task Management App', userName, onLogout, notificationCount = 0, workspaceName = 'Primary Workspace' }) => {
  return <div className='space-y-3'>

    <div className='flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-custom-md backdrop-blur md:flex-row md:items-center md:justify-between'>
      <div className='space-y-1'>
        <p className='text-xs font-semibold uppercase tracking-[0.2em] text-primary'>
          {workspaceName}
        </p>
        <h1 className='bg-gradient-primary bg-clip-text text-2xl font-black text-transparent sm:text-3xl'>
          {appName}
        </h1>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <div className='inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700'>
          <UserCircle2 className='size-4 text-slate-500' />
          <span className='font-medium'>{userName}</span>
        </div>

        <div className='inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700'>
          <Bell className='size-4 text-primary' />
          <span>{notificationCount} notifications</span>
        </div>

        <Button variant='outline' size='sm' onClick={onLogout}>Logout</Button>
      </div>
    </div>

  </div>
}

export default Header