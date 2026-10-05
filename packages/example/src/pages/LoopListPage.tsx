import { SpatialNavigationNode } from 'react-tv-space-navigation';
import { Page } from '../components/Page';
import { Typography } from '../design-system/components/Typography';
import { Box } from '../design-system/components/Box';
import { Spacer } from '../design-system/components/Spacer';
import { DefaultFocus } from '../../../lib/src/spatial-navigation/context/DefaultFocusContext';
import { ProgramsRow } from '../modules/program/view/ProgramList';
import { getPrograms } from '../modules/program/infra/programInfos';
import { useMemo } from 'react';

export const LoopListPage = () => {
  const programs = useMemo(() => getPrograms(8), []);

  return (
    <Page>
      <Box padding={'$8'}>
        <Typography>{'A list that loops: the data is repeated, forward and backward.'}</Typography>
      </Box>
      <Spacer gap="$6" />
      <DefaultFocus>
        <SpatialNavigationNode orientation="vertical">
          <ProgramsRow data={programs} loop />
        </SpatialNavigationNode>
      </DefaultFocus>
    </Page>
  );
};
