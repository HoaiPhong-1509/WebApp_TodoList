import AddTask from '@/components/AddTask';
import React, { useCallback, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import StatsAndFilters from '@/components/StatsAndFilters';
import TaskListPagination from '@/components/TaskListPagination';
import DateTimeFilter from '@/components/DateTimeFilter';
import TaskList from '@/components/TaskList';
import Footer from '@/components/Footer';
import ChatPanel from '@/components/ChatPanel';
import { toast } from 'sonner';
import api from '@/lib/axios';
import { visibleTaskLimit } from '@/lib/data';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { BrainCircuit, Check, ChevronsUpDown, FolderKanban, Sparkles, TrendingUp } from 'lucide-react';

const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const buildActivitySeriesFallback = (tasks) => {
  const days = 14;
  const now = new Date();
  const activityMap = new Map();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(now.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    activityMap.set(key, {
      key,
      label: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      createdCount: 0,
      completedCount: 0,
      netFlow: 0,
    });
  }

  tasks.forEach((task) => {
    if (task?.createdAt) {
      const createdKey = new Date(task.createdAt).toISOString().slice(0, 10);
      if (activityMap.has(createdKey)) {
        activityMap.get(createdKey).createdCount += 1;
      }
    }

    if (task?.completedAt) {
      const completedKey = new Date(task.completedAt).toISOString().slice(0, 10);
      if (activityMap.has(completedKey)) {
        activityMap.get(completedKey).completedCount += 1;
      }
    }
  });

  return Array.from(activityMap.values()).map((item) => ({
    ...item,
    netFlow: item.completedCount - item.createdCount,
  }));
};

const buildAiInsights = ({ total, todo, inProgress, completed, tasks }) => {
  if (!total) {
    return [
      'No task data yet. Create 3-5 concrete tasks to let AI analyze workload trends.',
      'Use action verbs in task titles to improve recommendation quality, for example: Draft API docs.',
      'Set one measurable completion criterion per task to reduce context switching and decision fatigue.',
    ];
  }

  const completionRate = Math.round((completed / total) * 100);
  const inProgressRate = Math.round((inProgress / total) * 100);
  const staleTodo = tasks.filter((task) => {
    if (task.status !== 'todo' || !task.createdAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(task.createdAt).getTime();
    return ageMs > 1000 * 60 * 60 * 24 * 3;
  }).length;

  const insights = [];

  if (completionRate >= 55) {
    insights.push(`Strong execution rhythm: ${completionRate}% tasks completed. Keep batching similar tasks in 60-90 minute focus blocks.`);
  } else {
    insights.push(`Completion rate is ${completionRate}%. Reduce active scope to raise throughput: pick top 3 priorities each day.`);
  }

  if (todo > completed) {
    insights.push(`Backlog pressure detected: ${todo} To Do vs ${completed} Completed. Schedule one daily backlog-trim session.`);
  }

  if (inProgressRate > 40) {
    insights.push(`In Progress load is high (${inProgressRate}%). Limiting WIP to 2-3 tasks can cut switching costs and improve finishing speed.`);
  } else {
    insights.push(`In Progress distribution is healthy (${inProgressRate}%). Keep this balance to maintain flow efficiency.`);
  }

  if (staleTodo > 0) {
    insights.push(`${staleTodo} To Do tasks are older than 3 days. Break each into a smaller first step to reduce procrastination friction.`);
  } else {
    insights.push('Backlog freshness is good. Continue pruning low-impact items weekly to preserve decision clarity.');
  }

  return insights;
};

const ActivityLineChart = ({ series }) => {
  const width = 460;
  const height = 220;
  const padding = 24;
  const maxValue = Math.max(
    ...series.map((item) => Math.max(item.createdCount, item.completedCount)),
    1
  );

  const mapPoint = (item, idx, value) => {
    const x = padding + (idx * (width - padding * 2)) / (series.length - 1 || 1);
    const y = height - padding - (value / maxValue) * (height - padding * 2);
    return { ...item, x, y };
  };

  const createdPoints = series.map((item, idx) => mapPoint(item, idx, item.createdCount));
  const completedPoints = series.map((item, idx) => mapPoint(item, idx, item.completedCount));

  const createdPolyline = createdPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const completedPolyline = completedPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className='w-full space-y-3'>
      <div className='flex flex-wrap items-center gap-4 text-xs text-slate-600'>
        <div className='inline-flex items-center gap-2'>
          <span className='size-2 rounded-full bg-violet-400' />
          Created
        </div>
        <div className='inline-flex items-center gap-2'>
          <span className='size-2 rounded-full bg-primary' />
          Completed
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className='h-56 w-full'
        role='img'
        aria-label='User activity line chart'
      >
        <defs>
          <linearGradient id='activityLineGradient' x1='0%' y1='0%' x2='100%' y2='0%'>
            <stop offset='0%' stopColor='#c4b5fd' />
            <stop offset='100%' stopColor='#8b5cf6' />
          </linearGradient>
          <linearGradient id='activityCompletionGradient' x1='0%' y1='0%' x2='100%' y2='0%'>
            <stop offset='0%' stopColor='#7c3aed' />
            <stop offset='100%' stopColor='#5b21b6' />
          </linearGradient>
        </defs>

        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke='#cbd5e1' strokeWidth='1' />

        <polyline
          fill='none'
          stroke='url(#activityLineGradient)'
          strokeWidth='2.5'
          strokeLinecap='round'
          strokeLinejoin='round'
          points={createdPolyline}
        />

        <polyline
          fill='none'
          stroke='url(#activityCompletionGradient)'
          strokeWidth='3'
          strokeLinecap='round'
          strokeLinejoin='round'
          points={completedPolyline}
        />

        {createdPoints.map((point) => (
          <g key={`created-${point.key}`}>
            <circle cx={point.x} cy={point.y} r='3.5' fill='#a78bfa' />
          </g>
        ))}

        {completedPoints.map((point) => (
          <g key={`completed-${point.key}`}>
            <circle cx={point.x} cy={point.y} r='4' fill='#6d28d9' />
            <text x={point.x} y={height - 8} textAnchor='middle' fontSize='11' fill='#64748b'>
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

const HomePage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [taskBuffer, setTaskBuffer] = useState([]);
  const [todoTaskCount, setTodoTaskCount] = useState(0);
  const [inProgressTaskCount, setInProgressTaskCount] = useState(0);
  const [completedTaskCount, setCompletedTaskCount] = useState(0);
  const [userTodoTaskCount, setUserTodoTaskCount] = useState(0);
  const [userInProgressTaskCount, setUserInProgressTaskCount] = useState(0);
  const [userCompletedTaskCount, setUserCompletedTaskCount] = useState(0);
  const [userTotalTaskCount, setUserTotalTaskCount] = useState(0);
  const [userActivitySeries, setUserActivitySeries] = useState([]);
  const [filter, setFilter] = useState('all');
  const [dateQuery, setDateQuery] = useState('today');
  const [page, setPage] = useState(1);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceResults, setWorkspaceResults] = useState([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isWorkspaceComboboxOpen, setIsWorkspaceComboboxOpen] = useState(false);

  const fetchTasks = useCallback(async (workspaceId = selectedWorkspaceId) => {
    if (!workspaceId) {
      setTaskBuffer([]);
      setTodoTaskCount(0);
      setInProgressTaskCount(0);
      setCompletedTaskCount(0);
      setUserTodoTaskCount(0);
      setUserInProgressTaskCount(0);
      setUserCompletedTaskCount(0);
      setUserTotalTaskCount(0);
      setUserActivitySeries([]);
      return;
    }

    try {
      const res = await api.get('/tasks', {
        params: {
          filter: dateQuery,
          workspaceId,
        },
      });
      setTaskBuffer(res.data.tasks);
      setTodoTaskCount(res.data.todoCount);
      setInProgressTaskCount(res.data.inProgressCount);
      setCompletedTaskCount(res.data.completedCount);
      setUserTodoTaskCount(res.data.userSummary?.todoCount || 0);
      setUserInProgressTaskCount(res.data.userSummary?.inProgressCount || 0);
      setUserCompletedTaskCount(res.data.userSummary?.completedCount || 0);
      setUserTotalTaskCount(res.data.userSummary?.totalCount || 0);
      setUserActivitySeries(res.data.userActivitySeries || []);

    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast.error('Failed to fetch tasks. Please try again later.');
    }
  }, [dateQuery, selectedWorkspaceId]);

  const fetchWorkspaces = useCallback(async (queryText = '', keepSelection = true) => {
    setIsWorkspaceLoading(true);
    try {
      const res = await api.get('/workspaces', {
        params: {
          q: queryText,
        },
      });

      const nextResults = res.data.workspaces || [];
      setWorkspaceResults(nextResults);

      if (!queryText) {
        setWorkspaces(nextResults);

        if (!keepSelection) {
          const firstId = nextResults[0]?._id || '';
          setSelectedWorkspaceId(firstId);
          if (firstId) {
            await fetchTasks(firstId);
          }
          return;
        }

        if (!selectedWorkspaceId && nextResults[0]?._id) {
          setSelectedWorkspaceId(nextResults[0]._id);
          await fetchTasks(nextResults[0]._id);
        }
      }
    } catch (error) {
      console.error('Error fetching workspaces:', error);
      toast.error('Failed to load workspaces.');
    } finally {
      setIsWorkspaceLoading(false);
    }
  }, [fetchTasks, selectedWorkspaceId]);

  useEffect(() => {
    fetchWorkspaces('', true);
  }, [fetchWorkspaces]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    fetchTasks(selectedWorkspaceId);
  }, [dateQuery, selectedWorkspaceId, fetchTasks]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchWorkspaces(workspaceQuery, true);
    }, 180);

    return () => clearTimeout(timer);
  }, [workspaceQuery, fetchWorkspaces]);

  useEffect(() => {
    setPage(1);
  }, [filter, dateQuery, selectedWorkspaceId]);

  const handleTaskChanged = () => {
    fetchTasks();
  };

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  const handleNext = () => {
    if (page < totalPages){
      setPage(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (page > 1){
      setPage(prev => prev - 1);
    }
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
  };

  const filteredTasks = taskBuffer.filter(task => {
    switch (filter) {
      case 'todo':
        return task.status === 'todo';
      case 'in_progress':
        return task.status === 'in_progress';
      case 'completed':
        return task.status === 'completed';
      default:
        return true;
    }
  });

  const visibleTasks = filteredTasks.slice(
    (page - 1) * visibleTaskLimit,
    page * visibleTaskLimit
  );

  const totalPages = Math.ceil(filteredTasks.length / visibleTaskLimit);
  const totalTaskCount = todoTaskCount + inProgressTaskCount + completedTaskCount;
  const activitySeries = userActivitySeries.length > 0 ? userActivitySeries : buildActivitySeriesFallback(taskBuffer);
  const activityCreatedTotal = activitySeries.reduce((sum, item) => sum + item.createdCount, 0);
  const activityCompletedTotal = activitySeries.reduce((sum, item) => sum + item.completedCount, 0);
  const activityEfficiency = activityCreatedTotal > 0
    ? Math.round((activityCompletedTotal / activityCreatedTotal) * 100)
    : (activityCompletedTotal > 0 ? 100 : 0);
  const aiInsights = buildAiInsights({
    total: totalTaskCount,
    todo: todoTaskCount,
    inProgress: inProgressTaskCount,
    completed: completedTaskCount,
    tasks: taskBuffer,
  });
  const selectedWorkspace = workspaces.find((workspace) => workspace._id === selectedWorkspaceId)
    || workspaceResults.find((workspace) => workspace._id === selectedWorkspaceId)
    || workspaces[0];
  const notificationCount = Math.min(todoTaskCount + inProgressTaskCount, 9);

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const createWorkspace = async () => {
    const normalized = newWorkspaceName.trim();
    if (!normalized) {
      toast.error('Enter workspace name to create.');
      return;
    }

    try {
      const res = await api.post('/workspaces', { name: normalized });
      const workspace = res.data.workspace;
      setWorkspaceQuery('');
      setNewWorkspaceName('');
      setSelectedWorkspaceId(workspace._id);
      await api.patch(`/workspaces/${workspace._id}/activate`);
      await fetchWorkspaces('', true);
      await fetchTasks(workspace._id);
      toast.success('Workspace created');
    } catch (error) {
      console.error('Error creating workspace:', error);
      const message = error.response?.data?.message || 'Failed to create workspace.';
      toast.error(message);
    }
  };

  const selectWorkspace = async (workspace) => {
    try {
      setSelectedWorkspaceId(workspace._id);
      setWorkspaceQuery('');
      setIsWorkspaceComboboxOpen(false);
      await api.patch(`/workspaces/${workspace._id}/activate`);
      await fetchWorkspaces('', true);
      await fetchTasks(workspace._id);
    } catch (error) {
      console.error('Error selecting workspace:', error);
      toast.error('Failed to select workspace.');
    }
  };

  return (
    <div className='relative min-h-screen w-full overflow-hidden bg-slate-50'>
      <div
        className='pointer-events-none absolute inset-0'
        style={{
          background: 'radial-gradient(1000px 600px at 8% -10%, rgba(167, 139, 250, 0.3), transparent 60%), radial-gradient(1000px 600px at 100% 110%, rgba(109, 40, 217, 0.22), transparent 55%)',
        }}
      />

      <div className='relative z-10 mx-auto w-full max-w-7xl px-4 pb-20 pt-8 sm:px-6 lg:px-8'>
        <Header
          appName='Task Management App'
          userName={user?.name || user?.email || 'User'}
          onLogout={handleLogout}
          notificationCount={notificationCount}
          workspaceName={selectedWorkspace?.name}
        />

        <div className='mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3'>
          <div className='space-y-6 lg:col-span-2'>
            <Card className='border-0 bg-white/90 shadow-custom-lg backdrop-blur'>
              <CardHeader className='space-y-2'>
                <CardTitle className='flex items-center gap-2 text-2xl'>
                  <FolderKanban className='size-6 text-primary' />
                  Workspace Hub
                </CardTitle>
                <CardDescription>
                  Search your workspace, open it, and all tasks will be stored by workspace.
                </CardDescription>
              </CardHeader>

              <CardContent className='space-y-4'>
                <div className='space-y-3'>
                  <Popover
                    open={isWorkspaceComboboxOpen}
                    onOpenChange={(nextOpen) => {
                      setIsWorkspaceComboboxOpen(nextOpen);
                      if (!nextOpen) {
                        setWorkspaceQuery('');
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant='outline'
                        role='combobox'
                        aria-expanded={isWorkspaceComboboxOpen}
                        className='h-11 w-full justify-between border-slate-200 bg-slate-50 text-left font-normal hover:bg-slate-100'
                      >
                        <span className='truncate'>
                          {selectedWorkspace?.name || 'Select workspace...'}
                        </span>
                        <ChevronsUpDown className='size-4 shrink-0 opacity-60' />
                      </Button>
                    </PopoverTrigger>

                    <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-0' align='start'>
                      <Command shouldFilter={false}>
                        <CommandInput
                          value={workspaceQuery}
                          onValueChange={setWorkspaceQuery}
                          placeholder='Search workspace...'
                        />
                        <CommandList>
                          {isWorkspaceLoading && (
                            <p className='px-3 py-2 text-sm text-slate-500'>Searching workspace...</p>
                          )}

                          {!isWorkspaceLoading && workspaceResults.length === 0 && (
                            <CommandEmpty>No workspace matched your keyword.</CommandEmpty>
                          )}

                          {!isWorkspaceLoading && workspaceResults.length > 0 && (
                            <CommandGroup>
                              {workspaceResults.map((workspace) => (
                                <CommandItem
                                  key={workspace._id}
                                  value={workspace.name}
                                  onSelect={() => selectWorkspace(workspace)}
                                >
                                  <Check
                                    className={cn(
                                      'mr-1 size-4 text-primary',
                                      workspace._id === selectedWorkspaceId ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  <span className='flex-1 truncate'>{workspace.name}</span>
                                  {workspace.isDefault && (
                                    <Badge variant='secondary' className='bg-primary/15 text-primary border-0'>Default</Badge>
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end'>
                    <Input
                      placeholder='Enter workspace name...'
                      value={newWorkspaceName}
                      onChange={(event) => setNewWorkspaceName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          createWorkspace();
                        }
                      }}
                      className='h-10 bg-white sm:max-w-xs'
                    />
                    <Button variant='outline' className='h-10 border-primary text-primary hover:bg-primary/10' onClick={createWorkspace}>
                      Create Workspace
                    </Button>
                  </div>
                </div>

                <div className='rounded-xl border border-slate-200 bg-slate-50/70 p-4'>
                  <p className='text-sm font-semibold text-slate-700'>Current Workspace</p>
                  <p className='text-lg font-bold text-slate-900'>{selectedWorkspace?.name || 'No workspace selected'}</p>
                  <p className='text-xs text-slate-500'>
                    {selectedWorkspace ? 'Tasks are scoped to this workspace.' : 'Pick or create a workspace to start.'}
                  </p>
                </div>

                <div className='space-y-5 rounded-xl border border-slate-200 bg-white p-4'>
                  <AddTask handleNewTaskAdded={handleTaskChanged} workspaceId={selectedWorkspaceId} />

                  <StatsAndFilters
                    filter={filter}
                    setFilter={setFilter}
                    todoTasksCount={todoTaskCount}
                    inProgressTasksCount={inProgressTaskCount}
                    completedTasksCount={completedTaskCount}
                  />

                  <TaskList
                    filteredTasks={visibleTasks}
                    filter={filter}
                    handleTaskChanged={handleTaskChanged}
                    workspaceId={selectedWorkspaceId}
                  />

                  <div className='flex flex-col items-center justify-between gap-4 sm:flex-row'>
                    <TaskListPagination
                      handleNext={handleNext}
                      handlePrev={handlePrev}
                      handlePageChange={handlePageChange}
                      page={page}
                      totalPages={totalPages}
                    />
                    <DateTimeFilter dateQuery={dateQuery} setDateQuery={setDateQuery} />
                  </div>

                  <Footer
                    todoTasksCount={todoTaskCount}
                    inProgressTasksCount={inProgressTaskCount}
                    completedTasksCount={completedTaskCount}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className='border-0 bg-white/90 shadow-custom-lg backdrop-blur'>
              <CardHeader className='space-y-2'>
                <CardTitle className='flex items-center gap-2 text-xl'>
                  <TrendingUp className='size-5 text-primary' />
                  User Activity Trend
                </CardTitle>
                <CardDescription>
                  Last 14 days: compare tasks created vs completed to understand execution momentum.
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <ActivityLineChart series={activitySeries} />

                <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                  <div className='rounded-lg border border-slate-200 bg-slate-50 p-3'>
                    <p className='text-xs text-slate-500'>Created (14d)</p>
                    <p className='text-lg font-bold text-slate-900'>{activityCreatedTotal}</p>
                  </div>
                  <div className='rounded-lg border border-slate-200 bg-slate-50 p-3'>
                    <p className='text-xs text-slate-500'>Completed (14d)</p>
                    <p className='text-lg font-bold text-slate-900'>{activityCompletedTotal}</p>
                  </div>
                  <div className='rounded-lg border border-slate-200 bg-slate-50 p-3'>
                    <p className='text-xs text-slate-500'>Completion efficiency</p>
                    <p className='text-lg font-bold text-slate-900'>{activityEfficiency}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className='space-y-6'>
            <Card className='border-0 bg-white/90 shadow-custom-lg backdrop-blur'>
              <CardHeader>
                <CardTitle className='text-xl'>Workflow Snapshot</CardTitle>
                <CardDescription>Task totals across all process stages</CardDescription>
              </CardHeader>
              <CardContent className='grid grid-cols-2 gap-3'>
                {[
                  { key: 'todo', color: 'bg-violet-100 text-violet-800', value: userTodoTaskCount },
                  { key: 'in_progress', color: 'bg-purple-100 text-purple-800', value: userInProgressTaskCount },
                  { key: 'completed', color: 'bg-fuchsia-100 text-fuchsia-800', value: userCompletedTaskCount },
                  { key: 'all', label: 'Total', color: 'bg-indigo-100 text-indigo-800', value: userTotalTaskCount },
                ].map((item) => (
                  <div key={item.key} className='rounded-xl border border-slate-200 bg-slate-50 p-3'>
                    <Badge className={`${item.color} border-0`}>{item.label || STATUS_LABELS[item.key]}</Badge>
                    <p className='mt-2 text-2xl font-extrabold text-slate-900'>{item.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className='border-0 bg-white/90 shadow-custom-lg backdrop-blur'>
              <CardHeader className='space-y-2'>
                <CardTitle className='flex items-center gap-2 text-xl'>
                  <BrainCircuit className='size-5 text-primary' />
                  AI Work Science Advisor
                </CardTitle>
                <CardDescription>
                  Frontend AI prototype: recommendations are generated from your current tasks.
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3'>
                {aiInsights.map((insight, index) => (
                  <div
                    key={index}
                    className='rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-slate-700'
                  >
                    <div className='mb-2 flex items-center gap-2 text-primary'>
                      <Sparkles className='size-4' />
                      Insight {index + 1}
                    </div>
                    <p>{insight}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ChatPanel />
    </div>


  )
}

export default HomePage;